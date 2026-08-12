export function discountFor({ subtotal, tier }) {
  if (tier === "gold") return subtotal * 0.2;
  if (tier === "silver") return subtotal * 0.1;
  return 0;
}
