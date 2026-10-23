import assert from "node:assert/strict";
import test from "node:test";

import {
  validateAdministratorPasswordChangeInput,
  validateInstanceInput,
} from "../lib/admin-validation.js";

function createValidInstanceInput(overrides = {}) {
  return {
    name: "Primary New API",
    baseUrl: "https://new-api.example.com/",
    username: "new-api-administrator",
    password: "new-api-password",
    group: "anthropic",
    namePrefix: "claude",
    startNumber: 1,
    continueFromExisting: true,
    priority: 0,
    weight: 0,
    dateMode: "auto",
    enabled: true,
    ...overrides,
  };
}

test("instance validation ignores removed Admin Hub fields", () => {
  const instanceInput = validateInstanceInput(createValidInstanceInput({
    connectionProtocol: "admin-hub",
    adminHubTargetSiteId: 13,
  }));

  assert.equal("connectionProtocol" in instanceInput, false);
  assert.equal("adminHubTargetSiteId" in instanceInput, false);
  assert.equal(instanceInput.baseUrl, "https://new-api.example.com");
});

test("instance validation permits an unchanged password while editing", () => {
  const instanceInput = validateInstanceInput(createValidInstanceInput({
    password: "",
  }), { passwordRequired: false });

  assert.equal(instanceInput.password, "");
});

test("administrator password validation requires matching passwords of sufficient length", () => {
  assert.deepEqual(validateAdministratorPasswordChangeInput({
    currentPassword: "administrator-password",
    newPassword: "updated-administrator-password",
    confirmPassword: "updated-administrator-password",
  }), {
    currentPassword: "administrator-password",
    newPassword: "updated-administrator-password",
  });

  assert.throws(
    () => validateAdministratorPasswordChangeInput({
      currentPassword: "administrator-password",
      newPassword: "short",
      confirmPassword: "short",
    }),
    /至少需要 10 个字符/,
  );
  assert.throws(
    () => validateAdministratorPasswordChangeInput({
      currentPassword: "administrator-password",
      newPassword: "updated-administrator-password",
      confirmPassword: "different-administrator-password",
    }),
    /两次输入的新密码不一致/,
  );
});
