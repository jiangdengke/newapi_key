export function createMemberAccountSession(store, memberIds) {
  const username = `test-member-${memberIds.join("-")}`;
  const password = "test-member-password";
  store.saveOrdinaryUser(null, { username, password, enabled: true, memberIds });
  const account = store.authenticateAccount(username, password);
  return store.createAccountSession(account.id);
}
