export type AuthState =
  | "SIGNED_OUT"
  | "AUTHORIZING_MICROSOFT"
  | "MICROSOFT_AUTHENTICATED"
  | "AUTHENTICATING_XBOX"
  | "AUTHORIZING_XSTS"
  | "AUTHENTICATING_MINECRAFT"
  | "CHECKING_ENTITLEMENTS"
  | "FETCHING_PROFILE"
  | "SIGNED_IN"
  | "REFRESH_REQUIRED"
  | "ERROR";

export class AuthStateMachine {
  private state: AuthState = "SIGNED_OUT";

  get current(): AuthState {
    return this.state;
  }

  transition(next: AuthState): void {
    this.state = next;
  }

  reset(): void {
    this.state = "SIGNED_OUT";
  }
}
