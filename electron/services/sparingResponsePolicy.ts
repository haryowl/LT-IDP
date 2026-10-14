/**
 * KLHK SPARING sometimes returns status:false with a "duplicate / already sent"
 * description after the data was already stored (e.g. client timeout then retry,
 * or overlapping queue + scheduler). Those must be treated as success so we do
 * not keep resending forever.
 */
export function isSparingAlreadyAcceptedResponse(desc: string | null | undefined): boolean {
  if (!desc) return false;
  const text = String(desc).toLowerCase();
  return (
    text.includes('duplikasi') ||
    text.includes('sudah terkirim') ||
    text.includes('data sudah terkirim') ||
    text.includes('already sent') ||
    text.includes('already exists') ||
    text.includes('duplicate')
  );
}
