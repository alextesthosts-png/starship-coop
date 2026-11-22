<?php
// Vanguard Wing community forum — front controller.
declare(strict_types=1);
require __DIR__ . '/../src/bootstrap.php';
require __DIR__ . '/../src/views.php';

$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
$path = rtrim($path, '/') ?: '/';
$method = $_SERVER['REQUEST_METHOD'];
$pdo = db();

// ---------------- routing ----------------
$routes = [
    ['GET', '#^/$#', 'page_home'],
    ['GET', '#^/c/([a-z0-9-]+)$#', 'page_category'],
    ['GET', '#^/t/(\d+)$#', 'page_thread'],
    ['GET|POST', '#^/new/([a-z0-9-]+)$#', 'page_new_thread'],
    ['POST', '#^/t/(\d+)/reply$#', 'act_reply'],
    ['POST', '#^/t/(\d+)/mod$#', 'act_moderate'],
    ['GET|POST', '#^/p/(\d+)/edit$#', 'page_edit_post'],
    ['POST', '#^/p/(\d+)/delete$#', 'act_delete_post'],
    ['GET|POST', '#^/register$#', 'page_register'],
    ['GET|POST', '#^/login$#', 'page_login'],
    ['POST', '#^/logout$#', 'act_logout'],
    ['GET', '#^/u/([^/]+)$#', 'page_profile'],
    ['GET|POST', '#^/settings$#', 'page_settings'],
    ['GET|POST', '#^/game-link$#', 'page_game_link'],
    ['GET', '#^/search$#', 'page_search'],
    ['GET', '#^/admin$#', 'page_admin'],
    ['POST', '#^/admin/user$#', 'act_admin_user'],
    ['POST', '#^/admin/category$#', 'act_admin_category'],
    ['GET', '#^/health$#', 'page_health'],
];
foreach ($routes as [$m, $re, $fn]) {
    if (preg_match($re, $path, $mm) && in_array($method, explode('|', $m), true)) { $fn(...array_slice($mm, 1)); exit; }
}
http_response_code(404);
layout('Not found', '<div class="card empty"><h2>Lost in space</h2><p>That page doesn\'t exist. <a href="/">Back to the forum</a>.</p></div>');

// ---------------- helpers for loading ----------------
function category_by_slug(string $slug): array {
    $st = db()->prepare('SELECT * FROM categories WHERE slug = ?'); $st->execute([$slug]);
    $c = $st->fetch();
    if (!$c) { http_response_code(404); layout('Not found', '<div class="card empty">Category not found.</div>'); }
    return $c;
}
function thread_by_id(int $id): array {
    $st = db()->prepare('SELECT t.*, c.slug AS cat_slug, c.name AS cat_name, c.staff_only FROM threads t JOIN categories c ON c.id = t.category_id WHERE t.id = ?');
    $st->execute([$id]);
    $t = $st->fetch();
    if (!$t) { http_response_code(404); layout('Not found', '<div class="card empty">Thread not found. It may have been deleted.</div>'); }
    return $t;
}
function can_post_in(array $cat, ?array $u): bool { return $u && (!$cat['staff_only'] || is_staff($u)); }
function check_cooldown(array $u): ?string {
    if (is_staff($u)) return null;
    $wait = (int)$u['last_post_at'] + POST_COOLDOWN - time();
    return $wait > 0 ? "Easy on the trigger, pilot: wait {$wait} more seconds before posting again." : null;
}
function touch_post_time(int $uid): void { db()->prepare('UPDATE users SET last_post_at = ? WHERE id = ?')->execute([time(), $uid]); }

// ---------------- pages ----------------
function page_health(): void { header('Content-Type: text/plain'); echo 'ok'; }

function page_home(): void {
    $pdo = db();
    $cats = $pdo->query('
      SELECT c.*,
        (SELECT COUNT(*) FROM threads t WHERE t.category_id = c.id) AS threads,
        (SELECT COUNT(*) FROM posts p JOIN threads t ON t.id = p.thread_id WHERE t.category_id = c.id) AS posts,
        (SELECT t.id FROM threads t WHERE t.category_id = c.id ORDER BY t.last_post_at DESC LIMIT 1) AS last_tid
      FROM categories c ORDER BY c.position, c.id')->fetchAll();
    $rows = '';
    foreach ($cats as $c) {
        $last = '<span class="muted">No threads yet</span>';
        if ($c['last_tid']) {
            $st = $pdo->prepare('SELECT t.id, t.title, t.last_post_at, u.username FROM threads t
                JOIN posts p ON p.id = (SELECT MAX(id) FROM posts WHERE thread_id = t.id) JOIN users u ON u.id = p.user_id WHERE t.id = ?');
            $st->execute([$c['last_tid']]);
            if ($l = $st->fetch()) $last = '<a href="/t/' . $l['id'] . '">' . h(mb_strimwidth($l['title'], 0, 48, '…')) . '</a><br><span class="muted">by ' . user_link($l) . ' · ' . ago((int)$l['last_post_at']) . '</span>';
        }
        $rows .= '<div class="cat-row">
          <div class="cat-main"><a class="cat-name" href="/c/' . h($c['slug']) . '">' . h($c['name']) . '</a>' . ($c['staff_only'] ? ' <span class="tag">Official</span>' : '') . '<p>' . h($c['description']) . '</p></div>
          <div class="cat-num"><b>' . $c['threads'] . '</b><span>threads</span></div>
          <div class="cat-num"><b>' . $c['posts'] . '</b><span>posts</span></div>
          <div class="cat-last">' . $last . '</div></div>';
    }
    $s = $pdo->query('SELECT (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM threads) t, (SELECT COUNT(*) FROM posts) p')->fetch();
    $newest = $pdo->query('SELECT username FROM users ORDER BY id DESC LIMIT 1')->fetch();
    $online = $pdo->prepare('SELECT username, role FROM users WHERE last_seen > ? ORDER BY username LIMIT 30');
    $online->execute([time() - 300]);
    $onl = array_map(fn($r) => user_link($r), $online->fetchAll());
    $intro = current_user() ? '' : '<div class="card hero"><h1>Welcome to the Vanguard Wing hangar</h1><p>Find wingmates, share gold-medal tactics, report bugs and help shape the game. <a class="btn small primary" href="/register">Create an account</a> <a class="btn small" href="/login">Log in</a></p></div>';
    layout('Forum', $intro . '<div class="card cats"><div class="cat-head"><span>Category</span><span>Threads</span><span>Posts</span><span>Latest</span></div>' . $rows . '</div>
      <div class="card stats"><b>' . $s['u'] . '</b> pilots · <b>' . $s['t'] . '</b> threads · <b>' . $s['p'] . '</b> posts'
      . ($newest ? ' · newest pilot ' . user_link($newest) : '') . '<br><span class="muted">Online now:</span> ' . ($onl ? implode(', ', $onl) : '<span class="muted">nobody, yet</span>') . '</div>');
}

function page_category(string $slug): void {
    $c = category_by_slug($slug); $u = current_user(); $pdo = db();
    $total = (int)$pdo->query('SELECT COUNT(*) FROM threads WHERE category_id = ' . (int)$c['id'])->fetchColumn();
    $pages = max(1, (int)ceil($total / PER_PAGE_THREADS));
    $page = min($pages, max(1, (int)($_GET['page'] ?? 1)));
    $st = $pdo->prepare('SELECT t.*, u.username,
        (SELECT u2.username FROM posts p JOIN users u2 ON u2.id = p.user_id WHERE p.thread_id = t.id ORDER BY p.id DESC LIMIT 1) AS last_user
        FROM threads t JOIN users u ON u.id = t.user_id WHERE t.category_id = ? ORDER BY t.pinned DESC, t.last_post_at DESC LIMIT ? OFFSET ?');
    $st->execute([$c['id'], PER_PAGE_THREADS, ($page - 1) * PER_PAGE_THREADS]);
    $rows = '';
    foreach ($st->fetchAll() as $t) {
        $icons = ($t['pinned'] ? '<span class="tag pin">Pinned</span> ' : '') . ($t['locked'] ? '<span class="tag lock">Locked</span> ' : '');
        $rows .= '<div class="thr-row"><div class="thr-main">' . $icons . '<a class="thr-title" href="/t/' . $t['id'] . '">' . h($t['title']) . '</a><br><span class="muted">by ' . user_link($t) . ' · ' . ago((int)$t['created_at']) . '</span></div>
          <div class="cat-num"><b>' . $t['reply_count'] . '</b><span>replies</span></div><div class="cat-num"><b>' . $t['views'] . '</b><span>views</span></div>
          <div class="cat-last">' . ago((int)$t['last_post_at']) . '<br><span class="muted">by ' . h($t['last_user'] ?? '') . '</span></div></div>';
    }
    $btn = can_post_in($c, $u) ? '<a class="btn primary" href="/new/' . h($c['slug']) . '">+ New thread</a>'
        : ($u ? '<span class="muted">Only Command and Wing Leaders post here.</span>' : '<a class="btn" href="/login?next=' . h(rawurlencode('/new/' . $c['slug'])) . '">Log in to post</a>');
    layout($c['name'], '<div class="page-head"><div><h1>' . h($c['name']) . '</h1><p class="muted">' . h($c['description']) . '</p></div>' . $btn . '</div>
      <div class="card">' . ($rows ?: '<div class="empty">No threads here yet. Be the first to start one!</div>') . '</div>' . pager($page, $pages, '/c/' . $c['slug']), [$c['name'] => null]);
}

function render_post(array $p, array $t, ?array $u, bool $first): string {
    $canEdit = $u && ($u['id'] === $p['user_id'] || is_staff($u));
    $canDel = $u && (is_staff($u) || ($u['id'] === $p['user_id'] && !$first));
    $actions = '';
    if ($canEdit) $actions .= '<a href="/p/' . $p['id'] . '/edit">Edit</a>';
    if ($canDel) $actions .= '<form method="post" action="/p/' . $p['id'] . '/delete" class="inline" data-confirm="Delete this post?">' . csrf_field()
        . '<button class="linkbtn danger" onclick="return confirm(\'' . ($first ? 'This deletes the whole thread. Continue?' : 'Delete this post?') . '\')">' . ($first ? 'Delete thread' : 'Delete') . '</button></form>';
    if ($u && !$t['locked']) $actions .= '<a href="#reply" class="quote-link" data-quote="' . h($p['username']) . '">Reply</a>';
    $ship = $p['ship'] ? '<div class="ship">Flies the <b>' . h(SHIPS[$p['ship']] ?? '') . '</b></div>' : '';
    return '<article class="post" id="p' . $p['id'] . '">
      <aside class="author"><div class="avatar">' . h(mb_strtoupper(mb_substr($p['username'], 0, 2))) . '</div>' . user_link($p) . role_badge($p['role']) . $ship
      . '<div class="muted small">' . $p['post_count'] . ' posts<br>joined ' . date('M Y', (int)$p['user_created']) . '</div></aside>
      <div class="post-body"><div class="post-meta"><a href="#p' . $p['id'] . '">' . date('j M Y, H:i', (int)$p['created_at']) . '</a>'
      . ($p['edited_at'] ? ' · <span class="muted">edited ' . ago((int)$p['edited_at']) . '</span>' : '') . '<span class="post-actions">' . $actions . '</span></div>
      <div class="content">' . render_markup($p['body']) . '</div></div></article>';
}

function page_thread(string $id): void {
    $t = thread_by_id((int)$id); $u = current_user(); $pdo = db();
    if (empty($_SESSION['viewed'][$t['id']])) { $_SESSION['viewed'][$t['id']] = 1; $pdo->prepare('UPDATE threads SET views = views + 1 WHERE id = ?')->execute([$t['id']]); }
    $total = (int)$pdo->query('SELECT COUNT(*) FROM posts WHERE thread_id = ' . (int)$t['id'])->fetchColumn();
    $pages = max(1, (int)ceil($total / PER_PAGE_POSTS));
    $page = isset($_GET['page']) ? min($pages, max(1, (int)$_GET['page'])) : 1;
    if (($_GET['page'] ?? '') === 'last') $page = $pages;
    $firstId = (int)$pdo->query('SELECT MIN(id) FROM posts WHERE thread_id = ' . (int)$t['id'])->fetchColumn();
    $st = $pdo->prepare('SELECT p.*, u.username, u.role, u.ship, u.created_at AS user_created,
        (SELECT COUNT(*) FROM posts WHERE user_id = u.id) AS post_count
        FROM posts p JOIN users u ON u.id = p.user_id WHERE p.thread_id = ? ORDER BY p.id LIMIT ? OFFSET ?');
    $st->execute([$t['id'], PER_PAGE_POSTS, ($page - 1) * PER_PAGE_POSTS]);
    $posts = '';
    foreach ($st->fetchAll() as $p) $posts .= render_post($p, $t, $u, (int)$p['id'] === $firstId);
    $mod = '';
    if (is_staff($u)) {
        $cats = $pdo->query('SELECT id, name FROM categories ORDER BY position')->fetchAll();
        $opts = implode('', array_map(fn($c) => '<option value="' . $c['id'] . '"' . ($c['id'] == $t['category_id'] ? ' selected' : '') . '>' . h($c['name']) . '</option>', $cats));
        $mod = '<form method="post" action="/t/' . $t['id'] . '/mod" class="modbar">' . csrf_field() . '<span class="muted">Moderation:</span>
          <button name="do" value="' . ($t['pinned'] ? 'unpin' : 'pin') . '" class="btn small">' . ($t['pinned'] ? 'Unpin' : 'Pin') . '</button>
          <button name="do" value="' . ($t['locked'] ? 'unlock' : 'lock') . '" class="btn small">' . ($t['locked'] ? 'Unlock' : 'Lock') . '</button>
          <select name="category">' . $opts . '</select><button name="do" value="move" class="btn small">Move</button>
          <button name="do" value="delete" class="btn small danger" onclick="return confirm(\'Delete this entire thread?\')">Delete thread</button></form>';
    }
    if ($t['locked'] && !is_staff($u)) $reply = '<div class="card empty">🔒 This thread is locked.</div>';
    elseif (!$u) $reply = '<div class="card empty"><a href="/login?next=' . h(rawurlencode('/t/' . $t['id'] . '?page=last')) . '">Log in</a> or <a href="/register">join</a> to reply.</div>';
    else $reply = '<form method="post" action="/t/' . $t['id'] . '/reply" class="card form" id="reply">' . csrf_field() . '<h3>Reply</h3>
        <textarea name="body" rows="6" maxlength="20000" required placeholder="Write your reply…"></textarea>' . fmt_help() . '<button class="btn primary">Post reply</button></form>';
    $head = '<div class="page-head"><div><h1>' . ($t['pinned'] ? '<span class="tag pin">Pinned</span> ' : '') . ($t['locked'] ? '<span class="tag lock">Locked</span> ' : '') . h($t['title']) . '</h1>
      <p class="muted">' . ($total - 1) . ' replies · ' . $t['views'] . ' views</p></div></div>';
    layout($t['title'], $head . $mod . pager($page, $pages, '/t/' . $t['id']) . $posts . pager($page, $pages, '/t/' . $t['id']) . $reply
        . '<script src="/assets/forum.js" defer></script>', [$t['cat_name'] => '/c/' . $t['cat_slug'], mb_strimwidth($t['title'], 0, 40, '…') => null]);
}

function page_new_thread(string $slug): void {
    $c = category_by_slug($slug); $u = require_login();
    if (!can_post_in($c, $u)) { flash('Only staff can start threads in this category.', 'warn'); redirect('/c/' . $c['slug']); }
    $title = trim((string)($_POST['title'] ?? '')); $body = trim((string)($_POST['body'] ?? '')); $err = '';
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        require_post();
        if (strlen_u($title) < 4 || strlen_u($title) > 120) $err = 'The title needs 4–120 characters.';
        elseif (strlen_u($body) < 2 || strlen_u($body) > 20000) $err = 'The message needs 2–20,000 characters.';
        elseif ($e = check_cooldown($u)) $err = $e;
        else {
            $pdo = db(); $pdo->beginTransaction(); $now = time();
            $pdo->prepare('INSERT INTO threads (category_id, user_id, title, created_at, last_post_at) VALUES (?, ?, ?, ?, ?)')->execute([$c['id'], $u['id'], $title, $now, $now]);
            $tid = (int)$pdo->lastInsertId();
            $pdo->prepare('INSERT INTO posts (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')->execute([$tid, $u['id'], $body, $now]);
            $pdo->commit(); touch_post_time((int)$u['id']);
            flash('Thread posted.'); redirect('/t/' . $tid);
        }
    }
    layout('New thread', '<form method="post" class="card form">' . csrf_field() . '<h1>New thread in ' . h($c['name']) . '</h1>'
        . ($err ? '<div class="flash err">' . h($err) . '</div>' : '')
        . '<label>Title<input name="title" maxlength="120" required value="' . h($title) . '" placeholder="What is it about?"></label>
        <label>Message<textarea name="body" rows="12" maxlength="20000" required>' . h($body) . '</textarea></label>' . fmt_help()
        . '<div class="row"><button class="btn primary">Post thread</button> <a href="/c/' . h($c['slug']) . '">Cancel</a></div></form>', [$c['name'] => '/c/' . $c['slug'], 'New thread' => null]);
}

function act_reply(string $id): void {
    require_post(); $u = require_login(); $t = thread_by_id((int)$id);
    if ($t['locked'] && !is_staff($u)) { flash('This thread is locked.', 'warn'); redirect('/t/' . $t['id']); }
    $body = trim((string)($_POST['body'] ?? ''));
    if (strlen_u($body) < 2 || strlen_u($body) > 20000) { flash('Your reply needs 2–20,000 characters.', 'err'); redirect('/t/' . $t['id'] . '?page=last'); }
    if ($e = check_cooldown($u)) { flash($e, 'warn'); redirect('/t/' . $t['id'] . '?page=last'); }
    $pdo = db(); $now = time();
    $pdo->prepare('INSERT INTO posts (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')->execute([$t['id'], $u['id'], $body, $now]);
    $pid = (int)$pdo->lastInsertId();
    $pdo->prepare('UPDATE threads SET last_post_at = ?, reply_count = reply_count + 1 WHERE id = ?')->execute([$now, $t['id']]);
    touch_post_time((int)$u['id']);
    redirect('/t/' . $t['id'] . '?page=last#p' . $pid);
}

function act_moderate(string $id): void {
    require_post(); $u = require_login(); $t = thread_by_id((int)$id);
    if (!is_staff($u)) { http_response_code(403); exit('Forbidden'); }
    $pdo = db();
    switch ($_POST['do'] ?? '') {
        case 'pin': case 'unpin': $pdo->prepare('UPDATE threads SET pinned = ? WHERE id = ?')->execute([$_POST['do'] === 'pin' ? 1 : 0, $t['id']]); break;
        case 'lock': case 'unlock': $pdo->prepare('UPDATE threads SET locked = ? WHERE id = ?')->execute([$_POST['do'] === 'lock' ? 1 : 0, $t['id']]); break;
        case 'move': $pdo->prepare('UPDATE threads SET category_id = ? WHERE id = ? AND EXISTS (SELECT 1 FROM categories WHERE id = ?)')->execute([(int)$_POST['category'], $t['id'], (int)$_POST['category']]); break;
        case 'delete': $pdo->prepare('DELETE FROM threads WHERE id = ?')->execute([$t['id']]); flash('Thread deleted.'); redirect('/c/' . $t['cat_slug']);
    }
    flash('Done.'); redirect('/t/' . $t['id']);
}

function post_by_id(int $id): array {
    $st = db()->prepare('SELECT p.*, t.title, t.locked, (SELECT MIN(id) FROM posts WHERE thread_id = p.thread_id) AS first_id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id = ?');
    $st->execute([$id]); $p = $st->fetch();
    if (!$p) { http_response_code(404); layout('Not found', '<div class="card empty">Post not found.</div>'); }
    return $p;
}

function page_edit_post(string $id): void {
    $u = require_login(); $p = post_by_id((int)$id);
    if ($u['id'] !== $p['user_id'] && !is_staff($u)) { http_response_code(403); layout('Forbidden', '<div class="card empty">You can only edit your own posts.</div>'); }
    $isFirst = (int)$p['first_id'] === (int)$p['id'];
    $body = (string)($_POST['body'] ?? $p['body']); $title = (string)($_POST['title'] ?? $p['title']); $err = '';
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        require_post(); $body = trim($body); $title = trim($title);
        if (strlen_u($body) < 2 || strlen_u($body) > 20000) $err = 'The message needs 2–20,000 characters.';
        elseif ($isFirst && (strlen_u($title) < 4 || strlen_u($title) > 120)) $err = 'The title needs 4–120 characters.';
        else {
            db()->prepare('UPDATE posts SET body = ?, edited_at = ? WHERE id = ?')->execute([$body, time(), $p['id']]);
            if ($isFirst) db()->prepare('UPDATE threads SET title = ? WHERE id = ?')->execute([$title, $p['thread_id']]);
            flash('Post updated.'); redirect('/t/' . $p['thread_id'] . '?page=last#p' . $p['id']);
        }
    }
    layout('Edit post', '<form method="post" class="card form">' . csrf_field() . '<h1>Edit post</h1>' . ($err ? '<div class="flash err">' . h($err) . '</div>' : '')
        . ($isFirst ? '<label>Thread title<input name="title" maxlength="120" required value="' . h($title) . '"></label>' : '')
        . '<label>Message<textarea name="body" rows="12" maxlength="20000" required>' . h($body) . '</textarea></label>' . fmt_help()
        . '<div class="row"><button class="btn primary">Save</button> <a href="/t/' . $p['thread_id'] . '">Cancel</a></div></form>');
}

function act_delete_post(string $id): void {
    require_post(); $u = require_login(); $p = post_by_id((int)$id);
    $isFirst = (int)$p['first_id'] === (int)$p['id'];
    if (!is_staff($u) && !($u['id'] === $p['user_id'] && !$isFirst)) { http_response_code(403); exit('Forbidden'); }
    $pdo = db();
    if ($isFirst) {
        $c = $pdo->prepare('SELECT c.slug FROM threads t JOIN categories c ON c.id = t.category_id WHERE t.id = ?'); $c->execute([$p['thread_id']]); $slug = $c->fetchColumn();
        $pdo->prepare('DELETE FROM threads WHERE id = ?')->execute([$p['thread_id']]);
        flash('Thread deleted.'); redirect('/c/' . $slug);
    }
    $pdo->prepare('DELETE FROM posts WHERE id = ?')->execute([$p['id']]);
    $pdo->prepare('UPDATE threads SET reply_count = MAX(0, reply_count - 1), last_post_at = COALESCE((SELECT MAX(created_at) FROM posts WHERE thread_id = ?), last_post_at) WHERE id = ?')->execute([$p['thread_id'], $p['thread_id']]);
    flash('Post deleted.'); redirect('/t/' . $p['thread_id']);
}

// ---------------- accounts ----------------
function page_register(): void {
    if (current_user()) redirect('/');
    $name = trim((string)($_POST['username'] ?? '')); $email = trim((string)($_POST['email'] ?? '')); $ship = (string)($_POST['ship'] ?? ''); $err = '';
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        require_post(); $pdo = db();
        $pw = (string)($_POST['password'] ?? ''); $pw2 = (string)($_POST['password2'] ?? '');
        $st = $pdo->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND at > ?'); $st->execute(['reg:' . client_ip(), time() - 3600]);
        if (!empty($_POST['website'])) $err = 'Registration failed.';                       // honeypot for bots
        elseif ((int)$st->fetchColumn() >= 3) $err = 'Too many new accounts from your network. Try again later.';
        elseif (!preg_match('/^[A-Za-z0-9_-]{3,20}$/', $name)) $err = 'Callsign: 3–20 letters, numbers, - or _.';
        elseif ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) $err = 'That email address doesn\'t look right (it\'s optional).';
        elseif (strlen($pw) < 8) $err = 'Password must be at least 8 characters.';
        elseif ($pw !== $pw2) $err = 'The passwords don\'t match.';
        elseif (!array_key_exists($ship, SHIPS)) $err = 'Pick a ship from the list.';
        else {
            $ex = $pdo->prepare('SELECT 1 FROM users WHERE username = ?'); $ex->execute([$name]);
            if ($ex->fetch()) $err = 'That callsign is taken.';
            else {
                $pdo->prepare('INSERT INTO users (username, email, password, ship, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)')
                    ->execute([$name, $email ?: null, password_hash($pw, PASSWORD_DEFAULT), $ship, time(), time()]);
                $newId = (int)$pdo->lastInsertId();   // read before any other INSERT
                $pdo->prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)')->execute(['reg:' . client_ip(), time()]);
                session_regenerate_id(true); $_SESSION['uid'] = $newId;
                flash("Welcome aboard, {$name}!"); redirect('/');
            }
        }
    }
    $opts = implode('', array_map(fn($k, $v) => '<option value="' . h($k) . '"' . ($k === $ship ? ' selected' : '') . '>' . h($v) . '</option>', array_keys(SHIPS), SHIPS));
    layout('Join', '<form method="post" class="card form narrow">' . csrf_field() . '<h1>Join the forum</h1>' . ($err ? '<div class="flash err">' . h($err) . '</div>' : '')
        . '<label>Callsign<input name="username" maxlength="20" required autocomplete="username" value="' . h($name) . '" placeholder="e.g. Nightjar"></label>
        <label>Email <span class="muted">(optional)</span><input name="email" type="email" maxlength="120" autocomplete="email" value="' . h($email) . '"></label>
        <label>Password <span class="muted">(8+ characters)</span><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        <label>Repeat password<input name="password2" type="password" minlength="8" required autocomplete="new-password"></label>
        <label>Favourite ship<select name="ship">' . $opts . '</select></label>
        <label class="hp">Website<input name="website" tabindex="-1" autocomplete="off"></label>
        <button class="btn primary">Create account</button><p class="muted">Already have one? <a href="/login">Log in</a></p></form>', ['Join' => null]);
}

function page_login(): void {
    $next = safe_next($_GET['next'] ?? $_POST['next'] ?? '/');
    if (current_user()) redirect($next);
    $name = trim((string)($_POST['username'] ?? '')); $err = '';
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        require_post();
        if (!login_allowed()) $err = 'Too many attempts. Wait 15 minutes and try again.';
        else {
            $st = db()->prepare('SELECT * FROM users WHERE username = ?'); $st->execute([$name]); $u = $st->fetch();
            if (!$u || !password_verify((string)($_POST['password'] ?? ''), $u['password'])) { record_login_failure(); $err = 'Wrong callsign or password.'; }
            elseif ($u['banned']) $err = 'This account has been suspended.';
            else {
                if (password_needs_rehash($u['password'], PASSWORD_DEFAULT)) db()->prepare('UPDATE users SET password = ? WHERE id = ?')->execute([password_hash((string)$_POST['password'], PASSWORD_DEFAULT), $u['id']]);
                session_regenerate_id(true); $_SESSION['uid'] = (int)$u['id'];
                flash('Welcome back, ' . $u['username'] . '!'); redirect($next);
            }
        }
    }
    layout('Log in', '<form method="post" class="card form narrow">' . csrf_field() . '<input type="hidden" name="next" value="' . h($next) . '"><h1>Log in</h1>'
        . ($err ? '<div class="flash err">' . h($err) . '</div>' : '')
        . '<label>Callsign<input name="username" required autocomplete="username" value="' . h($name) . '"></label>
        <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
        <button class="btn primary">Log in</button><p class="muted">New here? <a href="/register">Create an account</a></p></form>', ['Log in' => null]);
}

function act_logout(): void { require_post(); $_SESSION = []; session_regenerate_id(true); flash('You are logged out.'); redirect('/'); }

function page_profile(string $name): void {
    $st = db()->prepare('SELECT *, (SELECT COUNT(*) FROM posts WHERE user_id = users.id) AS post_count, (SELECT COUNT(*) FROM threads WHERE user_id = users.id) AS thread_count FROM users WHERE username = ?');
    $st->execute([$name]); $p = $st->fetch();
    if (!$p) { http_response_code(404); layout('Not found', '<div class="card empty">No pilot with that callsign.</div>'); }
    $rec = db()->prepare('SELECT p.id, p.body, p.created_at, t.id AS tid, t.title FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.user_id = ? ORDER BY p.id DESC LIMIT 8');
    $rec->execute([$p['id']]);
    $list = '';
    foreach ($rec->fetchAll() as $r) $list .= '<li><a href="/t/' . $r['tid'] . '?page=last#p' . $r['id'] . '">' . h($r['title']) . '</a> <span class="muted">· ' . ago((int)$r['created_at']) . '</span><div class="muted small">' . h(mb_strimwidth($r['body'], 0, 140, '…')) . '</div></li>';
    layout($p['username'], '<div class="card profile"><div class="avatar big">' . h(mb_strtoupper(mb_substr($p['username'], 0, 2))) . '</div><div>
        <h1>' . h($p['username']) . ' ' . role_badge($p['role']) . ($p['banned'] ? ' <span class="tag lock">Suspended</span>' : '') . '</h1>
        <p>' . ($p['ship'] ? 'Flies the <b>' . h(SHIPS[$p['ship']]) . '</b> · ' : '') . 'joined ' . date('j M Y', (int)$p['created_at']) . ' · ' . $p['post_count'] . ' posts · ' . $p['thread_count'] . ' threads'
        . ($p['last_seen'] ? ' · last seen ' . ago((int)$p['last_seen']) : '') . '</p>'
        . ($p['bio'] ? '<div class="content">' . render_markup($p['bio']) . '</div>' : '') . '</div></div>
        <div class="card"><h3>Recent posts</h3>' . ($list ? '<ul class="recent">' . $list . '</ul>' : '<div class="empty">No posts yet.</div>') . '</div>', [$p['username'] => null]);
}

// "Sign in with your forum account" from the game: hands the game a signed pilot pass
// (callsign + role, valid 30 days). The game checks the signature with the same GAME_LINK_SECRET.
function page_game_link(): void {
    $u = require_login();
    $secret = getenv('GAME_LINK_SECRET') ?: '';
    if ($secret === '') layout('Link to the game', '<div class="card"><h1>Link to the game</h1><p>Game sign-in isn\'t set up on this server yet (GAME_LINK_SECRET is missing).</p></div>');
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        require_post();
        $b64 = fn(string $s): string => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
        $body = $b64(json_encode(['u' => $u['username'], 'r' => $u['role'], 'exp' => time() + 30 * 86400], JSON_UNESCAPED_UNICODE));
        $sig = $b64(hash_hmac('sha256', $body, $secret, true));
        header('Location: ' . GAME_URL . '/#pilot=' . $body . '.' . $sig, true, 303);
        exit;
    }
    layout('Link to the game', '<div class="card narrow"><h1>Fly as ' . h($u['username']) . '?</h1>
      <p>The game will use your forum callsign <b>' . h($u['username']) . '</b> and your rank <b>' . h(ROLES[$u['role']] ?? 'Pilot') . '</b>, which unlocks the liveries for your rank. The link lasts 30 days on this browser.</p>
      <form method="post">' . csrf_field() . '<button class="btn">Link and return to the game</button> <a class="btn ghost" href="' . h(GAME_URL) . '">Cancel</a></form></div>', ['Link to the game' => null]);
}

function page_settings(): void {
    $u = require_login(); $pdo = db(); $err = '';
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        require_post();
        if (($_POST['form'] ?? '') === 'profile') {
            $ship = (string)($_POST['ship'] ?? ''); $bio = trim((string)($_POST['bio'] ?? '')); $email = trim((string)($_POST['email'] ?? ''));
            if (!array_key_exists($ship, SHIPS)) $err = 'Pick a ship from the list.';
            elseif (strlen_u($bio) > 1000) $err = 'Bio: up to 1000 characters.';
            elseif ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) $err = 'That email address doesn\'t look right.';
            else { $pdo->prepare('UPDATE users SET ship = ?, bio = ?, email = ? WHERE id = ?')->execute([$ship, $bio, $email ?: null, $u['id']]); flash('Profile saved.'); redirect('/settings'); }
        } else {
            $cur = (string)($_POST['current'] ?? ''); $new = (string)($_POST['new'] ?? '');
            if (!password_verify($cur, $u['password'])) $err = 'Current password is wrong.';
            elseif (strlen($new) < 8) $err = 'New password must be at least 8 characters.';
            elseif ($new !== ($_POST['new2'] ?? '')) $err = 'The new passwords don\'t match.';
            else { $pdo->prepare('UPDATE users SET password = ? WHERE id = ?')->execute([password_hash($new, PASSWORD_DEFAULT), $u['id']]); session_regenerate_id(true); flash('Password changed.'); redirect('/settings'); }
        }
    }
    $opts = implode('', array_map(fn($k, $v) => '<option value="' . h($k) . '"' . ($k === $u['ship'] ? ' selected' : '') . '>' . h($v) . '</option>', array_keys(SHIPS), SHIPS));
    layout('Settings', ($err ? '<div class="flash err">' . h($err) . '</div>' : '') . '<div class="grid2">
      <form method="post" class="card form">' . csrf_field() . '<input type="hidden" name="form" value="profile"><h2>Profile</h2>
        <label>Favourite ship<select name="ship">' . $opts . '</select></label>
        <label>Email <span class="muted">(optional, not shown publicly)</span><input name="email" type="email" value="' . h($u['email'] ?? '') . '"></label>
        <label>Bio<textarea name="bio" rows="5" maxlength="1000">' . h($u['bio']) . '</textarea></label>' . fmt_help() . '<button class="btn primary">Save profile</button></form>
      <form method="post" class="card form">' . csrf_field() . '<input type="hidden" name="form" value="password"><h2>Change password</h2>
        <input type="text" name="username" value="' . h($u['username']) . '" autocomplete="username" class="hp" tabindex="-1">
        <label>Current password<input name="current" type="password" required autocomplete="current-password"></label>
        <label>New password<input name="new" type="password" minlength="8" required autocomplete="new-password"></label>
        <label>Repeat new password<input name="new2" type="password" minlength="8" required autocomplete="new-password"></label>
        <button class="btn primary">Change password</button></form></div>', ['Settings' => null]);
}

function page_search(): void {
    $q = trim((string)($_GET['q'] ?? '')); $rows = '';
    if (strlen_u($q) >= 2) {
        $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
        $st = db()->prepare("SELECT p.id, p.body, p.created_at, t.id AS tid, t.title, u.username FROM posts p JOIN threads t ON t.id = p.thread_id JOIN users u ON u.id = p.user_id
            WHERE t.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\' ORDER BY p.id DESC LIMIT 40");
        $st->execute([$like, $like]);
        foreach ($st->fetchAll() as $r) $rows .= '<li><a href="/t/' . $r['tid'] . '#p' . $r['id'] . '">' . h($r['title']) . '</a> <span class="muted">· ' . user_link($r) . ' · ' . ago((int)$r['created_at']) . '</span><div class="muted small">' . h(mb_strimwidth($r['body'], 0, 180, '…')) . '</div></li>';
    }
    layout('Search', '<div class="card"><form action="/search" class="row"><input name="q" value="' . h($q) . '" placeholder="Search threads and posts" autofocus> <button class="btn primary">Search</button></form>'
        . ($q === '' ? '' : ($rows ? '<ul class="recent">' . $rows . '</ul>' : '<div class="empty">Nothing found for “' . h($q) . '”.</div>')) . '</div>', ['Search' => null]);
}

// ---------------- admin ----------------
function require_admin(): array { $u = require_login(); if (!is_admin($u)) { http_response_code(403); layout('Forbidden', '<div class="card empty">Command clearance required.</div>'); } return $u; }

function page_admin(): void {
    $me = require_admin(); $pdo = db();
    $s = $pdo->query('SELECT (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM users WHERE banned = 1) b, (SELECT COUNT(*) FROM threads) t, (SELECT COUNT(*) FROM posts) p,
        (SELECT COUNT(*) FROM posts WHERE created_at > ' . (time() - 86400) . ') p24, (SELECT COUNT(*) FROM users WHERE created_at > ' . (time() - 86400 * 7) . ') u7')->fetch();
    $q = trim((string)($_GET['q'] ?? ''));
    $st = $pdo->prepare("SELECT u.*, (SELECT COUNT(*) FROM posts WHERE user_id = u.id) AS posts FROM users u WHERE username LIKE ? ORDER BY u.id DESC LIMIT 100");
    $st->execute(['%' . $q . '%']);
    $users = '';
    foreach ($st->fetchAll() as $u) {
        $self = $u['id'] === $me['id'];
        $roles = implode('', array_map(fn($k, $v) => '<option value="' . $k . '"' . ($k === $u['role'] ? ' selected' : '') . '>' . $v . '</option>', array_keys(ROLES), ROLES));
        $users .= '<tr><td>' . user_link($u) . ($u['banned'] ? ' <span class="tag lock">Banned</span>' : '') . '</td><td class="muted">' . h($u['email'] ?? '') . '</td><td>' . $u['posts'] . '</td><td class="muted">' . date('j M Y', (int)$u['created_at']) . '</td><td class="muted">' . ($u['last_seen'] ? ago((int)$u['last_seen']) : '—') . '</td><td>'
            . ($self ? '<span class="muted">you</span>' : '<form method="post" action="/admin/user" class="inline">' . csrf_field() . '<input type="hidden" name="id" value="' . $u['id'] . '">
              <select name="role">' . $roles . '</select><button name="do" value="role" class="btn small">Set role</button>
              <button name="do" value="' . ($u['banned'] ? 'unban' : 'ban') . '" class="btn small ' . ($u['banned'] ? '' : 'danger') . '">' . ($u['banned'] ? 'Unban' : 'Ban') . '</button>
              <button name="do" value="purge" class="btn small danger" onclick="return confirm(\'Delete ALL posts and threads by ' . h($u['username']) . '?\')">Delete posts</button></form>') . '</td></tr>';
    }
    $cats = '';
    foreach ($pdo->query('SELECT c.*, (SELECT COUNT(*) FROM threads WHERE category_id = c.id) AS n FROM categories c ORDER BY position, id')->fetchAll() as $c) {
        $cats .= '<form method="post" action="/admin/category" class="cat-edit">' . csrf_field() . '<input type="hidden" name="id" value="' . $c['id'] . '">
          <input name="position" type="number" value="' . $c['position'] . '" class="pos" title="Order">
          <input name="name" value="' . h($c['name']) . '" maxlength="40" required>
          <input name="description" value="' . h($c['description']) . '" maxlength="200" class="grow">
          <label class="chk"><input type="checkbox" name="staff_only" value="1"' . ($c['staff_only'] ? ' checked' : '') . '> staff only</label>
          <span class="muted">' . $c['n'] . ' threads</span>
          <button name="do" value="save" class="btn small">Save</button>
          <button name="do" value="delete" class="btn small danger" onclick="return confirm(\'Delete this category and its ' . $c['n'] . ' threads?\')">Delete</button></form>';
    }
    layout('Admin', '<h1>Command deck</h1>
      <div class="statgrid"><div><b>' . $s['u'] . '</b>pilots</div><div><b>' . $s['u7'] . '</b>new this week</div><div><b>' . $s['t'] . '</b>threads</div><div><b>' . $s['p'] . '</b>posts</div><div><b>' . $s['p24'] . '</b>posts today</div><div><b>' . $s['b'] . '</b>banned</div></div>
      <div class="card"><h2>Categories</h2><p class="muted">Lower numbers show first. “Staff only” means only Command and Wing Leaders can start threads (everyone can still reply).</p>' . $cats . '
        <form method="post" action="/admin/category" class="cat-edit new">' . csrf_field() . '<input name="position" type="number" value="99" class="pos"><input name="name" placeholder="New category name" maxlength="40" required>
        <input name="description" placeholder="Short description" maxlength="200" class="grow"><label class="chk"><input type="checkbox" name="staff_only" value="1"> staff only</label>
        <button name="do" value="add" class="btn small primary">+ Add category</button></form></div>
      <div class="card"><div class="page-head"><h2>Pilots</h2><form class="row" action="/admin"><input name="q" value="' . h($q) . '" placeholder="Find a callsign"><button class="btn small">Find</button></form></div>
        <p class="muted">Roles: <b>Pilot</b> (normal user), <b>Wing Leader</b> (moderator: pin, lock, move, delete), <b>Command</b> (admin: this page).</p>
        <div class="tablewrap"><table class="users"><tr><th>Callsign</th><th>Email</th><th>Posts</th><th>Joined</th><th>Last seen</th><th>Actions</th></tr>' . $users . '</table></div></div>', ['Admin' => null]);
}

function act_admin_user(): void {
    require_post(); $me = require_admin(); $pdo = db(); $id = (int)($_POST['id'] ?? 0);
    if ($id === (int)$me['id']) { flash('You can\'t change your own account here.', 'warn'); redirect('/admin'); }
    switch ($_POST['do'] ?? '') {
        case 'role': if (array_key_exists($_POST['role'] ?? '', ROLES)) $pdo->prepare('UPDATE users SET role = ? WHERE id = ?')->execute([$_POST['role'], $id]); flash('Role updated.'); break;
        case 'ban': $pdo->prepare('UPDATE users SET banned = 1 WHERE id = ?')->execute([$id]); flash('Pilot banned.'); break;
        case 'unban': $pdo->prepare('UPDATE users SET banned = 0 WHERE id = ?')->execute([$id]); flash('Pilot unbanned.'); break;
        case 'purge':
            $pdo->prepare('DELETE FROM threads WHERE user_id = ?')->execute([$id]);
            $pdo->prepare('DELETE FROM posts WHERE user_id = ?')->execute([$id]);
            $pdo->exec('UPDATE threads SET reply_count = MAX(0, (SELECT COUNT(*) FROM posts WHERE thread_id = threads.id) - 1)');
            flash('All their posts were deleted.'); break;
    }
    redirect('/admin');
}

function act_admin_category(): void {
    require_post(); require_admin(); $pdo = db();
    $name = trim((string)($_POST['name'] ?? '')); $desc = trim((string)($_POST['description'] ?? '')); $pos = (int)($_POST['position'] ?? 0); $staff = !empty($_POST['staff_only']) ? 1 : 0;
    $do = $_POST['do'] ?? '';
    if (in_array($do, ['add', 'save'], true) && (strlen_u($name) < 2 || strlen_u($name) > 40)) { flash('Category name: 2–40 characters.', 'err'); redirect('/admin'); }
    if ($do === 'add') {
        $slug = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($name)), '-') ?: 'category';
        $base = $slug; $i = 2;
        while ($pdo->query('SELECT 1 FROM categories WHERE slug = ' . $pdo->quote($slug))->fetch()) $slug = $base . '-' . $i++;
        $pdo->prepare('INSERT INTO categories (slug, name, description, position, staff_only) VALUES (?, ?, ?, ?, ?)')->execute([$slug, $name, mb_substr($desc, 0, 200), $pos, $staff]);
        flash('Category added.');
    } elseif ($do === 'save') {
        $pdo->prepare('UPDATE categories SET name = ?, description = ?, position = ?, staff_only = ? WHERE id = ?')->execute([$name, mb_substr($desc, 0, 200), $pos, $staff, (int)$_POST['id']]);
        flash('Category saved.');
    } elseif ($do === 'delete') {
        $pdo->prepare('DELETE FROM categories WHERE id = ?')->execute([(int)$_POST['id']]);
        flash('Category deleted.');
    }
    redirect('/admin');
}
