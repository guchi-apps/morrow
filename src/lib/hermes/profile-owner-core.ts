/** Hermes profileの持ち主の照合（純粋な部分。#1181）。未設定・空は全員拒否。 */
export function isProfileOwner(ownerEmail: string | null | undefined, userEmail: string | null | undefined): boolean {
  const owner = (ownerEmail ?? "").trim().toLowerCase();
  const user = (userEmail ?? "").trim().toLowerCase();
  return owner !== "" && owner === user;
}
