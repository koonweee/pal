const sidebar = document.querySelector<HTMLDialogElement>('#thread-sidebar')!;
const openButton = document.querySelector<HTMLButtonElement>('#thread-open')!;
const navigation = document.querySelector<HTMLElement>('#thread-nav')!;
const desktopSlot = document.querySelector<HTMLElement>('#thread-nav-slot')!;
const mobileSlot = document.querySelector<HTMLElement>('#mobile-thread-nav')!;
const mobile = window.matchMedia('(max-width: 650px)');

export function closeThreadSidebar() {
  if (sidebar.open) sidebar.close();
}

function layout() {
  closeThreadSidebar();
  (mobile.matches ? mobileSlot : desktopSlot).append(navigation);
}

openButton.addEventListener('click', () => {
  if (!mobile.matches || sidebar.open) return;
  sidebar.showModal();
  openButton.setAttribute('aria-expanded', 'true');
  navigation.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus();
});
document
  .querySelector('#thread-close')!
  .addEventListener('click', closeThreadSidebar);
sidebar.addEventListener('close', () =>
  openButton.setAttribute('aria-expanded', 'false'),
);
sidebar.addEventListener('click', (event) => {
  const bounds = sidebar.getBoundingClientRect();
  if (
    event.target === sidebar &&
    (event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom)
  )
    closeThreadSidebar();
});
mobile.addEventListener('change', layout);
layout();
