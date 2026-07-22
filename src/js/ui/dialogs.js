/**
 * Shared behaviour for every modal in the app, solo table and local
 * multiplayer room alike.
 *
 * A native <dialog> keeps the scroll offset its body had when it was last
 * closed, so a long panel (help, settings, the legal information page)
 * reopened after a read would start halfway down instead of at its title.
 * Every modal therefore opens through openDialog.
 *
 * Order matters: a closed dialog has display: none, so it owns no scroll box
 * and an assignment to scrollTop is silently discarded. The dialog is shown
 * first, then every scrolling region inside it is put back at the top. The
 * reset also lands after showModal has moved focus, and each dialog's first
 * focusable control sits in its header, so nothing focused is scrolled out of
 * sight by this.
 */

/**
 * Put every scrolling region inside a dialog, or inside one of its pages,
 * back at the top.
 *
 * @param {HTMLElement} root A <dialog> or a .dialog__page inside one.
 */
export function resetDialogScroll(root) {
  // The dialog element itself is a scroll container in every browser's UA
  // stylesheet; it only ever scrolls if a page overflows the column layout,
  // but resetting it costs nothing and keeps the reopened panel predictable.
  root.scrollTop = 0;
  for (const body of root.querySelectorAll('.dialog__body')) {
    body.scrollTop = 0;
  }
}

/**
 * Show a modal dialog from the top of its content.
 *
 * @param {HTMLDialogElement} dialog
 */
export function openDialog(dialog) {
  dialog.showModal();
  resetDialogScroll(dialog);
}
