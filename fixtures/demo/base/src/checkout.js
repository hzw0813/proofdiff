import { discountFor } from "./discount.js";

export function totalFor(order) {
  return order.subtotal - discountFor(order);
}
