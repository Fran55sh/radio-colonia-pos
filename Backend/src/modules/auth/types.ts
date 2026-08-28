export type LoginResponse = {
  token: string;
  expires_at: string;
};

export type SessionResponse = {
  authenticated: true;
  expires_at: string;
};
