// "Reply" links pre-fill the reply box with a mention of the author.
document.addEventListener('click', (e) => {
  const a = e.target.closest('.quote-link');
  if (!a) return;
  const box = document.querySelector('#reply textarea');
  if (!box) return;
  e.preventDefault();
  const post = a.closest('.post');
  const text = post ? post.querySelector('.content').innerText.trim().split('\n').slice(0, 4).join('\n') : '';
  box.value += (box.value ? '\n\n' : '') + `> **${a.dataset.quote}:** ${text.replace(/\n/g, '\n> ')}\n\n`;
  box.focus();
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
