/** "450.000đ" — tiền là số nguyên VND. */
export const formatCurrency = (value: number) => `${Math.round(value).toLocaleString("vi-VN")}đ`;
