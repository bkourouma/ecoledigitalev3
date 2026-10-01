"use client";

import { platformHooks } from "@/platform/api/default-client";
import { createAccessHooks } from "./hooks";

export * from "./types";
export { createAccessHooks, type AccessState } from "./hooks";

/** Instances branchées sur le client API du navigateur. */
export const { useMyPermissions, useMyEntitlements, usePermission, useFeature } = createAccessHooks(platformHooks);
