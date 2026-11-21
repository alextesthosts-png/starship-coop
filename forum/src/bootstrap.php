<?php
// Vanguard Wing community forum — core: config, database, sessions, security helpers.
declare(strict_types=1);

const ROLES = ['user' => 'Pilot', 'moderator' => 'Wing Leader', 'admin' => 'Command'];
const SHIPS = ['' => '—', 'lancer' => 'Lancer', 'warden' => 'Warden', 'hammer' => 'Hammer'];
const PER_PAGE_THREADS = 20;
const PER_PAGE_POSTS = 15;
const POST_COOLDOWN = 15; // seconds between posts per user

$DATA_DIR = getenv('FORUM_DATA') ?: (is_dir('/data') ? '/data' : __DIR__ . '/../data');
if (!is_dir($DATA_DIR)) mkdir($DATA_DIR, 0770, true);
define('GAME_URL', rtrim(getenv('GAME_URL') ?: 'https://vanguard-wing-production.up.railway.app', '/'));
define('IS_HTTPS', ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'));

// ---------------- session ----------------
session_name('vwforum');
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => IS_HTTPS, 'httponly' => true, 'samesite' => 'Lax']);
if (!is_dir($DATA_DIR . '/sessions')) mkdir($DATA_DIR . '/sessions', 0770, true);
session_save_path($DATA_DIR . '/sessions');
session_start();

header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header("Content-Security-Policy: default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'");

// ---------------- database ----------------
function db(): PDO {
    static $pdo = null;
    global $DATA_DIR;
    if ($pdo) return $pdo;
    $pdo = new PDO('sqlite:' . $DATA_DIR . '/forum.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    migrate($pdo);
    return $pdo;
}

function migrate(PDO $pdo): void {
    $pdo->exec("
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT, password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user', banned INTEGER NOT NULL DEFAULT 0, ship TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, last_seen INTEGER, last_post_at INTEGER);
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0, staff_only INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_post_at INTEGER NOT NULL, reply_count INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at INTEGER NOT NULL, edited_at INTEGER);
    CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_threads_cat ON threads(category_id, pinned DESC, last_post_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id, id);
    ");
    // seed categories once
    if ((int)$pdo->query('SELECT COUNT(*) FROM categories')->fetchColumn() === 0) {
        $seed = [
            ['announcements', 'Announcements', 'News, patch notes and events from Command.', 1],
            ['general', 'General Hangar', 'Anything about Vanguard Wing.', 0],
            ['lfg', 'Looking for Wingmates', 'Find pilots for co-op runs. Post your wing code!', 0],
            ['tactics', 'Tactics & Missions', 'Strategies for Outpost Siege, Convoy Intercept and Fall of the Ravager. Gold-medal routes welcome.', 0],
            ['ships', 'Ships & Loadouts', 'Lancer, Warden or Hammer? Discuss ships, weapons and roles.', 0],
            ['bugs', 'Bug Reports', 'Something broke? Tell us what happened and how to repeat it.', 0],
            ['ideas', 'Suggestions', 'Ideas for new missions, ships and features.', 0],
        ];
        $st = $pdo->prepare('INSERT INTO categories (slug, name, description, position, staff_only) VALUES (?, ?, ?, ?, ?)');
        foreach ($seed as $i => $c) $st->execute([$c[0], $c[1], $c[2], $i, $c[3]]);
    }
    // bootstrap the first admin from environment variables
    $au = getenv('FORUM_ADMIN_USER'); $ap = getenv('FORUM_ADMIN_PASSWORD');
    if ($au && $ap && (int)$pdo->query("SELECT COUNT(*) FROM users WHERE role = 'admin'")->fetchColumn() === 0) {
        $ex = $pdo->prepare('SELECT id FROM users WHERE username = ?'); $ex->execute([$au]);
        if ($id = $ex->fetchColumn()) $pdo->prepare("UPDATE users SET role = 'admin' WHERE id = ?")->execute([$id]);
        else $pdo->prepare("INSERT INTO users (username, password, role, created_at) VALUES (?, ?, 'admin', ?)")->execute([$au, password_hash($ap, PASSWORD_DEFAULT), time()]);
    }
}

// ---------------- helpers ----------------
function h(?string $s): string { return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function url(string $path = '/', array $q = []): string { return $path . ($q ? '?' . http_build_query($q) : ''); }
function redirect(string $to): never { header('Location: ' . $to, true, 303); exit; }
function flash(string $msg, string $type = 'ok'): void { $_SESSION['flash'][] = [$type, $msg]; }
function take_flash(): array { $f = $_SESSION['flash'] ?? []; unset($_SESSION['flash']); return $f; }
function client_ip(): string { return trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '')[0]) ?: ($_SERVER['REMOTE_ADDR'] ?? '?'); }
function ago(int $t): string {
    $d = time() - $t;
    if ($d < 60) return 'just now';
    if ($d < 3600) return floor($d / 60) . ' min ago';
    if ($d < 86400) return floor($d / 3600) . ' h ago';
    if ($d < 86400 * 7) return floor($d / 86400) . ' d ago';
    return date('j M Y', $t);
}
function strlen_u(string $s): int { return mb_strlen($s, 'UTF-8'); }

// ---------------- CSRF ----------------
function csrf_token(): string { return $_SESSION['csrf'] ??= bin2hex(random_bytes(32)); }
function csrf_field(): string { return '<input type="hidden" name="csrf" value="' . h(csrf_token()) . '">'; }
function require_post(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !hash_equals(csrf_token(), (string)($_POST['csrf'] ?? ''))) {
        http_response_code(400); exit('Invalid request (form expired). Go back, reload the page and try again.');
    }
}

// ---------------- auth ----------------
function current_user(): ?array {
    static $u = false;
    if ($u !== false) return $u;
    $u = null;
    if (!empty($_SESSION['uid'])) {
        $st = db()->prepare('SELECT * FROM users WHERE id = ?'); $st->execute([$_SESSION['uid']]);
        $u = $st->fetch() ?: null;
        if ($u && $u['banned']) { $_SESSION = []; $u = null; }
        if ($u && (int)($u['last_seen'] ?? 0) < time() - 60) db()->prepare('UPDATE users SET last_seen = ? WHERE id = ?')->execute([time(), $u['id']]);
    }
    return $u;
}
function is_staff(?array $u = null): bool { $u ??= current_user(); return $u && in_array($u['role'], ['moderator', 'admin'], true); }
function is_admin(?array $u = null): bool { $u ??= current_user(); return $u && $u['role'] === 'admin'; }
function require_login(): array {
    $u = current_user();
    if (!$u) { flash('Please log in first.', 'warn'); redirect(url('/login', ['next' => $_SERVER['REQUEST_URI'] ?? '/'])); }
    return $u;
}
function login_allowed(): bool {
    $pdo = db();
    $pdo->prepare('DELETE FROM login_attempts WHERE at < ?')->execute([time() - 900]);
    $st = $pdo->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ?'); $st->execute([client_ip()]);
    return (int)$st->fetchColumn() < 8;
}
function record_login_failure(): void { db()->prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)')->execute([client_ip(), time()]); }
function safe_next(?string $n): string { return ($n && str_starts_with($n, '/') && !str_starts_with($n, '//')) ? $n : '/'; }

// ---------------- formatting (escape first, then a few markers) ----------------
function inline_markup(string $s): string {
    $s = h($s);
    $s = preg_replace('/`([^`]+)`/', '<code>$1</code>', $s);
    $s = preg_replace('/\*\*([^*]+)\*\*/', '<b>$1</b>', $s);
    $s = preg_replace('/(^|[^*])\*([^*\s][^*]*)\*/', '$1<i>$2</i>', $s);
    $s = preg_replace_callback('/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/', fn($m) => '<a href="' . $m[2] . '" rel="nofollow noopener noreferrer" target="_blank">' . $m[1] . '</a>', $s);
    // bare links
    $s = preg_replace_callback('/(?<![">])\bhttps?:\/\/[^\s<]+/', fn($m) => '<a href="' . $m[0] . '" rel="nofollow noopener noreferrer" target="_blank">' . $m[0] . '</a>', $s);
    return $s;
}
function render_markup(string $text): string {
    $out = []; $para = []; $list = null; $quote = null;
    $flush = function () use (&$out, &$para, &$list, &$quote) {
        if ($para) { $out[] = '<p>' . implode('<br>', array_map('inline_markup', $para)) . '</p>'; $para = []; }
        if ($list) { $out[] = '<ul>' . implode('', array_map(fn($l) => '<li>' . inline_markup($l) . '</li>', $list)) . '</ul>'; $list = null; }
        if ($quote) { $out[] = '<blockquote>' . implode('<br>', array_map('inline_markup', $quote)) . '</blockquote>'; $quote = null; }
    };
    foreach (preg_split('/\r?\n/', $text) as $line) {
        $line = rtrim($line);
        if (preg_match('/^\s*[-•]\s+(.*)$/', $line, $m)) { if ($para || $quote) { $l = $list; $list = null; $flush(); $list = $l; } $list[] = $m[1]; continue; }
        if (preg_match('/^>\s?(.*)$/', $line, $m)) { if ($para || $list) { $q = $quote; $quote = null; $flush(); $quote = $q; } $quote[] = $m[1]; continue; }
        if (trim($line) === '') { $flush(); continue; }
        if ($list || $quote) $flush();
        $para[] = $line;
    }
    $flush();
    return implode('', $out);
}
