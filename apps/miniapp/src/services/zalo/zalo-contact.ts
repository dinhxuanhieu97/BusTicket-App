import { useMutation } from "@tanstack/react-query";
import { getAccessToken, getPhoneNumber, getUserInfo } from "zmp-sdk/apis";
import { bookingService } from "../booking/booking.api";

export interface ZaloContact {
  /** Tên Zalo, rỗng nếu khách không cho phép chia sẻ tên. */
  name: string;
  phone: string;
  phoneToken: string;
  expiresAt: string;
}

/** Khách từ chối hoặc đóng hộp thoại xin quyền của Zalo. */
export class ZaloPermissionDenied extends Error {}

async function zaloName(): Promise<string> {
  try {
    const { userInfo } = await getUserInfo({ autoRequestPermission: true });
    return userInfo.name?.trim() ?? "";
  } catch {
    // Không cho phép chia sẻ tên vẫn dùng được số điện thoại.
    return "";
  }
}

/**
 * Lấy tên + SĐT Zalo của khách (Zalo hiện hộp thoại xin phép).
 * Token số điện thoại chỉ dùng được một lần, hết hạn sau 2 phút, nên đổi ngay qua máy chủ.
 */
export async function fetchZaloContact(): Promise<ZaloContact> {
  const name = await zaloName();
  let token: string | undefined;
  try {
    ({ token } = await getPhoneNumber());
  } catch {
    throw new ZaloPermissionDenied();
  }
  if (!token) throw new ZaloPermissionDenied();
  const accessToken = await getAccessToken();
  const result = await bookingService.zaloPhone(accessToken, token);
  return { name, ...result };
}

export function useZaloContact() {
  return useMutation({ mutationFn: fetchZaloContact });
}
