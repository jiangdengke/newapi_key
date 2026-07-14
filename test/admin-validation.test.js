import assert from "node:assert/strict";
import test from "node:test";

import {
  validateAdministratorPasswordChangeInput,
  validateInstanceInput,
} from "../lib/admin-validation.js";

function createValidInstanceInput(overrides = {}) {
  return {
    name: "Deepnix",
    baseUrl: "https://open.deepnix.ai/",
    username: "supplier-user",
    password: "supplier-password",
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

test("instance validation defaults to standard New API", () => {
  const instanceInput = validateInstanceInput(createValidInstanceInput({
    adminHubTargetSiteId: 13,
  }));

  assert.equal(instanceInput.connectionProtocol, "new-api");
  assert.equal(instanceInput.adminHubTargetSiteId, null);
  assert.equal(instanceInput.baseUrl, "https://open.deepnix.ai");
});

test("instance validation accepts Admin Hub target site 13", () => {
  const instanceInput = validateInstanceInput(createValidInstanceInput({
    connectionProtocol: "admin-hub",
    adminHubTargetSiteId: "13",
  }));

  assert.equal(instanceInput.connectionProtocol, "admin-hub");
  assert.equal(instanceInput.adminHubTargetSiteId, 13);
});

test("instance validation rejects invalid protocols and Admin Hub site IDs", () => {
  assert.throws(
    () => validateInstanceInput(createValidInstanceInput({
      connectionProtocol: "unsupported",
    })),
    /连接协议无效/,
  );

  for (const invalidSiteId of [undefined, "", 0, -1, 1.5]) {
    assert.throws(
      () => validateInstanceInput(createValidInstanceInput({
        connectionProtocol: "admin-hub",
        adminHubTargetSiteId: invalidSiteId,
      })),
      /Admin Hub 目标站点 ID 必须是正整数/,
    );
  }
});

test("instance validation permits an unchanged password while editing", () => {
  const instanceInput = validateInstanceInput(createValidInstanceInput({
    password: "",
    connectionProtocol: "admin-hub",
    adminHubTargetSiteId: 13,
  }), { passwordRequired: false });

  assert.equal(instanceInput.password, "");
  assert.equal(instanceInput.adminHubTargetSiteId, 13);
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
