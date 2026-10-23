import { HttpError } from "./http.js";

export function requireInstanceMember(store, instanceId, memberId) {
  const member = store.getInstanceMember(memberId);
  if (!member || member.instanceId !== Number(instanceId)) {
    throw new HttpError(404, "访问成员不存在");
  }
  return member;
}

export function withMemberUniquenessMessage(operation) {
  try {
    return operation();
  } catch (error) {
    if (/UNIQUE constraint failed: instance_members\.instance_id, instance_members\.name_prefix/.test(error?.message)) {
      throw new HttpError(409, "该实例已有成员使用这个名称前缀");
    }
    if (/UNIQUE constraint failed: instance_members\.instance_id, instance_members\.name\b/.test(error?.message)) {
      throw new HttpError(409, "该实例已有同名成员");
    }
    throw error;
  }
}
