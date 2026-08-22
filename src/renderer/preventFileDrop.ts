/**
 * Make a file dropped anywhere on the window inert.
 *
 * Without this, Chromium navigates the top-level frame to the dropped file. Main blocks that
 * navigation now (see the `will-navigate` guard), but relying on a single guard for something this
 * cheap to stop twice would be a poor trade: this is the layer that keeps the drop from ever
 * becoming a navigation in the first place.
 *
 * XOP has no drag-and-drop feature. When it grows one — dropping a project file, say — this becomes
 * a real handler rather than a refusal, and it stays the single place that decides.
 */
export function preventFileDrop(target: Window = window): void {
  const swallow = (event: DragEvent): void => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  target.addEventListener('dragover', swallow);
  target.addEventListener('drop', swallow);
}
