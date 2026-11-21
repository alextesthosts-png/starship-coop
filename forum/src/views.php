<?php
// Layout + shared view fragments.
declare(strict_types=1);

function layout(string $title, string $body, array $crumbs = []): never {
    $u = current_user();
    $flash = '';
    foreach (take_flash() as [$type, $msg]) $flash .= '<div class="flash ' . h($type) . '">' . h($msg) . '</div>';
    $crumb = '';
    if ($crumbs) {
        $parts = ['<a href="/">Forum</a>'];
        foreach ($crumbs as $label => $href) $parts[] = $href ? '<a href="' . h($href) . '">' . h($label) . '</a>' : '<span>' . h($label) . '</span>';
        $crumb = '<nav class="crumbs">' . implode(' <i>›</i> ', $parts) . '</nav>';
    }
    $userNav = $u
        ? '<a class="me" href="/u/' . h(rawurlencode($u['username'])) . '">' . h($u['username']) . ' ' . role_badge($u['role']) . '</a>'
          . (is_admin($u) ? '<a href="/admin">Admin</a>' : '')
          . '<a href="/settings">Settings</a>'
          . '<form method="post" action="/logout" class="inline">' . csrf_field() . '<button class="linkbtn">Log out</button></form>'
        : '<a href="/login">Log in</a><a class="btn small primary" href="/register">Join the forum</a>';
    $game = h(GAME_URL);
    $t = h($title);
    header('Content-Type: text/html; charset=utf-8');
    echo <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{$t} · Vanguard Wing Forum</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Rajdhani:wght@500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/forum.css">
</head>
<body>
<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="/">VANGUARD <span>WING</span> <em>Forum</em></a>
    <form class="search" action="/search" method="get"><input name="q" placeholder="Search the forum…" aria-label="Search"></form>
    <nav class="user">{$userNav}</nav>
    <a class="btn small play" href="{$game}">▶ Play the game</a>
  </div>
</header>
<main class="wrap">
{$crumb}
{$flash}
{$body}
</main>
<footer class="wrap foot">Vanguard Wing community forum · <a href="{$game}">Back to the game</a> · Be kind, fly together.</footer>
</body>
</html>
HTML;
    exit;
}

function role_badge(string $role): string {
    if ($role === 'user') return '';
    return '<span class="role ' . h($role) . '">' . h(ROLES[$role] ?? $role) . '</span>';
}
function user_link(array $row, string $prefix = ''): string {
    $name = $row[$prefix . 'username'] ?? '[deleted]';
    return '<a class="ulink" href="/u/' . h(rawurlencode($name)) . '">' . h($name) . '</a>';
}
function pager(int $page, int $pages, string $base, array $q = []): string {
    if ($pages <= 1) return '';
    $out = '<nav class="pager">';
    for ($p = 1; $p <= $pages; $p++) {
        if ($pages > 9 && $p > 2 && $p < $pages - 1 && abs($p - $page) > 2) { if (!str_ends_with($out, '…')) $out .= '<span>…</span>'; continue; }
        $out .= $p === $page ? '<b>' . $p . '</b>' : '<a href="' . h(url($base, $q + ['page' => $p])) . '">' . $p . '</a>';
    }
    return $out . '</nav>';
}
function fmt_help(): string {
    return '<div class="fmt">Formatting: <code>**bold**</code> <code>*italic*</code> <code>`code`</code> <code>[text](https://…)</code> <code>- list</code> <code>&gt; quote</code></div>';
}
