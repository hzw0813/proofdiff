export function discountFor({ subtotal, tier }) {
  const safeSubtotal = Math.max(0, Number(subtotal));
  if (tier === "gold") return safeSubtotal * 0.2;
  if (tier === "silver") return safeSubtotal * 0.1;
  return 0;
}
