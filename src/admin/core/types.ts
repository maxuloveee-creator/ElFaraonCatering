export type StaffRole = "operator" | "admin";
export type ServiceKind = "daily-menu" | "grill";
export type TargetKind = "daily-menu" | "grill" | "catalog";
export type AdminTabId = "service" | "availability" | "fixed" | "account";
export type ServiceSectionId = "active-service" | "daily-menu" | "grill";
export type StatusTone = "neutral" | "success" | "danger";
export type FixedMenuEditMode = "items" | "options-only";
export type AuthView = "login" | "reset-request" | "set-password";
export type PublicationPhase = "up_to_date" | "changes_pending" | "publishing" | "failed";

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface StaffState {
  user_id: string;
  display_name: string;
  role: StaffRole;
  profile_id: string | null;
  default_availability_profile_id: string | null;
  active: boolean;
}

export interface PermissionState {
  can_edit_availability: boolean;
  can_edit_menu_content: boolean;
  can_publish_menu: boolean;
  can_manage_staff: boolean;
}

export interface ProfileState {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  can_edit_availability: boolean;
}

export interface ServiceSettingState {
  profile_id: string;
  service_kind: ServiceKind;
}

export interface DailyMenuState {
  item_id: string;
  name: string;
  description: string | null;
  pricing_key: string;
  order_index: number;
}

export interface AvailabilityTargetState {
  menu_id: string;
  profile_title: string;
  target_kind: TargetKind;
  section_id: string;
  section_title: string;
  group_title: string | null;
  item_id: string;
  name: string;
  description: string | null;
  base_available: boolean;
  price_amount: number | null;
}

export interface AvailabilityOverlayState {
  menu_id: string;
  section_id: string;
  item_id: string;
  available_override: boolean;
  updated_at: string;
}

export interface FixedPriceState {
  pricing_key: string;
  amount: number;
}

export interface VariantPriceState {
  pricing_key: string;
  variant_id: string;
  name: string;
  amount: number;
  order_index: number;
}

export interface GrillFamilyState {
  family_id: string;
  title: string;
  order_index: number;
  item_count: number;
}

export interface GrillItemState {
  family_id: string;
  family_title: string;
  item_id: string;
  name: string;
  variant_name: string | null;
  pricing_key: string;
  price_amount: number | null;
  order_index: number;
}

export interface GrillEditorState {
  families: GrillFamilyState[];
  items: GrillItemState[];
}

export interface CatalogSectionState {
  section_id: string;
  title: string;
  order_index: number;
  item_count: number;
}

export interface CatalogItemState {
  section_id: string;
  section_title: string;
  item_id: string;
  name: string;
  description: string | null;
  pricing_key: string | null;
  price_amount: number | null;
  order_index: number;
  has_image: boolean;
  option_count: number;
  options: CatalogItemOptionState[];
}

export interface CatalogItemOptionState {
  section_id: string;
  item_id: string;
  option_id: string;
  name: string;
  order_index: number;
}

export interface CatalogEditorState {
  sections: CatalogSectionState[];
  items: CatalogItemState[];
}

export interface PublicationState {
  phase: PublicationPhase;
  has_newer_changes: boolean;
  can_retry: boolean;
  requested_at: string | null;
  expires_at: string | null;
}

export interface AdminOperationalState {
  ok: boolean;
  message: string;
  staff: StaffState | null;
  permissions: PermissionState;
  profiles: ProfileState[];
  service_settings: ServiceSettingState[];
  daily_menu: DailyMenuState[];
  availability_targets: AvailabilityTargetState[];
  availability_overlays: AvailabilityOverlayState[];
  prices: {
    fixed: FixedPriceState[];
    variants: VariantPriceState[];
  };
  grill_editor: GrillEditorState;
  catalog_editor: CatalogEditorState;
  publication: PublicationState;
}

export interface RpcResult {
  ok: boolean;
  changed: boolean;
  requires_redeploy: boolean;
  operation: string;
  message: string;
}

export interface StatusMessage {
  text: string;
  tone: StatusTone;
}

export type AdminStatusText = string | ((state: AdminOperationalState) => string);
export type RenderFocusMode = "preserve" | "view" | "tab";

export interface RenderOptions {
  focus?: RenderFocusMode;
  tabId?: AdminTabId;
  revealStatus?: boolean;
}

export interface PricingLabel {
  title: string;
  tags: string[];
}

export interface AuthApiResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: object;
}
