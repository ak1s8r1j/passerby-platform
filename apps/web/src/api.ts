import {
  ErrorResponse,
  MeResponse,
  StatsResponse,
  type ChangePasswordRequest,
  type DeleteAccountRequest,
  type LoginRequest,
  type PublicUser,
  type RegisterRequest,
} from "@passerby/shared";

/** Every API call goes through here, so responses are checked against the shared shapes. */
export async function getStats(signal?: AbortSignal): Promise<StatsResponse> {
  const res = await fetch("/api/v1/stats", { signal });
  if (!res.ok) throw new Error(`stats failed: ${res.status}`);
  return StatsResponse.parse(await res.json());
}

/** A request the server turned down. `message` is written to be shown to the visitor as it is. */
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

const GENERIC = "Something went wrong. Try again.";

async function call(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(
      "Couldn't reach the server. Check your connection and try again.",
      "network",
      0,
    );
  }
  if (res.ok) return res;
  const parsed = ErrorResponse.safeParse(await res.json().catch(() => null));
  throw parsed.success
    ? new ApiError(parsed.data.error.message, parsed.data.error.code, res.status)
    : new ApiError(GENERIC, "error", res.status);
}

const post = (path: string, body: unknown = {}) =>
  call(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function user(res: Response): Promise<PublicUser> {
  const { user } = MeResponse.parse(await res.json());
  if (!user) throw new ApiError(GENERIC, "error", res.status);
  return user;
}

// ---- accounts ----

/** The signed-in account, or null. */
export const getMe = async (): Promise<PublicUser | null> =>
  MeResponse.parse(await (await call("/api/v1/auth/me")).json()).user;

export const register = async (body: RegisterRequest) =>
  user(await post("/api/v1/auth/register", body));
export const signIn = async (body: LoginRequest) => user(await post("/api/v1/auth/login", body));
export const signOut = async () => void (await post("/api/v1/auth/logout"));
export const changePassword = async (body: ChangePasswordRequest) =>
  void (await post("/api/v1/auth/password", body));
/** Disconnect the Google account (only allowed once the account has a password). */
export const unlinkGoogle = async () => void (await post("/api/v1/auth/google/unlink"));
export const deleteAccount = async (body: DeleteAccountRequest) =>
  void (await post("/api/v1/auth/delete", body));

/** Where the browser downloads the visitor's own data from. */
export const EXPORT_URL = "/api/v1/auth/export";
