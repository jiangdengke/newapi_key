"use client";

import { useEffect, useState } from "react";
import {
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";

import { requestJson } from "../lib/client-api.js";
import { formatChannelNamePattern } from "../lib/format.js";
import { showToast } from "../lib/toast.js";
import {
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  Field,
  Modal,
  Select,
  Sheet,
  Spinner,
  Switch,
} from "./ui.js";

const DATE_CHOICES = Object.freeze({
  INHERIT: "inherit",
  NONE: "none",
  AUTO: "auto",
  FIXED: "fixed",
});

function describeDateMode(dateMode) {
  if (dateMode === "auto") {
    return "当天 MMDD";
  }
  return dateMode ? `固定 ${dateMode}` : "不加日期";
}

function createMemberFormFromMember(member) {
  const dateChoice = member.dateMode === null
    ? DATE_CHOICES.INHERIT
    : member.dateMode === ""
      ? DATE_CHOICES.NONE
      : member.dateMode === "auto" ? DATE_CHOICES.AUTO : DATE_CHOICES.FIXED;
  return {
    name: member.name,
    namePrefix: member.namePrefix,
    userId: member.userId === null ? "" : String(member.userId),
    dateChoice,
    fixedDate: dateChoice === DATE_CHOICES.FIXED ? member.dateMode : "",
    startNumber: member.startNumber === null ? "" : String(member.startNumber),
    priority: member.priority === null ? "" : String(member.priority),
    weight: member.weight === null ? "" : String(member.weight),
  };
}

function readDateMode(memberForm) {
  if (memberForm.dateChoice === DATE_CHOICES.INHERIT) {
    return null;
  }
  if (memberForm.dateChoice === DATE_CHOICES.NONE) {
    return "";
  }
  return memberForm.dateChoice === DATE_CHOICES.AUTO ? "auto" : memberForm.fixedDate.trim();
}

function readOptionalNumber(rawValue) {
  return String(rawValue).trim() === "" ? null : Number(rawValue);
}

function createMemberRequestBody(memberForm, enabled) {
  return {
    name: memberForm.name,
    namePrefix: memberForm.namePrefix,
    userId: memberForm.userId ? Number(memberForm.userId) : null,
    dateMode: readDateMode(memberForm),
    startNumber: readOptionalNumber(memberForm.startNumber),
    priority: readOptionalNumber(memberForm.priority),
    weight: readOptionalNumber(memberForm.weight),
    enabled,
  };
}

function resolveMemberDefaults(instance, member) {
  return {
    namePrefix: member.namePrefix || instance.namePrefix,
    dateMode: member.dateMode ?? instance.dateMode,
    startNumber: member.startNumber ?? instance.startNumber,
    priority: member.priority ?? instance.priority,
    weight: member.weight ?? instance.weight,
  };
}

function InheritedValue({ value, inherited }) {
  return (
    <span className={inherited ? "member-inherited" : undefined} title={inherited ? "沿用实例默认值" : undefined}>
      {value}
    </span>
  );
}

function MemberFormFields({ instance, memberForm, onChange, editingMember, members, users }) {
  const previewDefaults = resolveMemberDefaults(instance, {
    namePrefix: memberForm.namePrefix.trim(),
    dateMode: readDateMode(memberForm),
    startNumber: readOptionalNumber(memberForm.startNumber),
    priority: null,
    weight: null,
  });
  return (
    <div className="form-grid">
      <Field label="成员名称" hint="用于区分是谁在使用，例如 张三。">
        <input className="input" value={memberForm.name} onChange={(event) => onChange("name", event.target.value)} required />
      </Field>
      <Field label="名称前缀" hint="该成员导入的渠道都以它开头，同一实例内不能重复。">
        <input className="input" placeholder="例如 zhangsan" value={memberForm.namePrefix} onChange={(event) => onChange("namePrefix", event.target.value)} required />
      </Field>
      <Field label="绑定用户" hint="绑定后用户可访问此实例，并查看该成员已有记录。留空则不授权。" wide>
        <Select value={memberForm.userId} onChange={(event) => onChange("userId", event.target.value)}>
          <option value="">不绑定用户</option>
          {users.map((user) => {
            const otherMember = members.find((member) => member.id !== editingMember?.id && member.userId === user.id);
            return (
              <option key={user.id} value={user.id} disabled={Boolean(otherMember)}>
                {user.username}{otherMember ? "（已绑定本实例其他成员）" : ""}
              </option>
            );
          })}
        </Select>
      </Field>
      <p className="callout callout-info field-wide">成员归属包含该成员的全部历史记录。改绑会让新用户获得这些记录，并撤销原用户的实例访问权限。</p>
      <Field label="日期模式" wide>
        <div className="member-date-row">
          <Select aria-label="日期模式" value={memberForm.dateChoice} onChange={(event) => onChange("dateChoice", event.target.value)}>
            <option value={DATE_CHOICES.INHERIT}>沿用实例（{describeDateMode(instance.dateMode)}）</option>
            <option value={DATE_CHOICES.NONE}>不加日期</option>
            <option value={DATE_CHOICES.AUTO}>当天 MMDD</option>
            <option value={DATE_CHOICES.FIXED}>固定日期</option>
          </Select>
          {memberForm.dateChoice === DATE_CHOICES.FIXED ? (
            <input
              className="input"
              aria-label="固定日期"
              placeholder="例如 0711"
              inputMode="numeric"
              maxLength={4}
              value={memberForm.fixedDate}
              onChange={(event) => onChange("fixedDate", event.target.value)}
              required
            />
          ) : null}
        </div>
      </Field>
      <Field label="起始序号" hint="留空沿用实例。">
        <input className="input" type="number" min="1" max="999999" placeholder={`沿用 ${instance.startNumber}`} value={memberForm.startNumber} onChange={(event) => onChange("startNumber", event.target.value)} />
      </Field>
      <Field label="渠道优先级" hint="留空沿用实例。">
        <input className="input" type="number" step="1" placeholder={`沿用 ${instance.priority}`} value={memberForm.priority} onChange={(event) => onChange("priority", event.target.value)} />
      </Field>
      <Field label="渠道权重" hint="留空沿用实例。">
        <input className="input" type="number" min="0" step="1" placeholder={`沿用 ${instance.weight}`} value={memberForm.weight} onChange={(event) => onChange("weight", event.target.value)} />
      </Field>
      <div className="member-preview field-wide">
        <span>渠道命名预览</span>
        <code>{previewDefaults.namePrefix ? formatChannelNamePattern(previewDefaults) : "先填写名称前缀"}</code>
        {instance.continueFromExisting ? <small>已开启接续：会从上游同前缀的最大序号之后继续编号</small> : null}
      </div>
    </div>
  );
}

export default function InstanceMembersSheet({ instance, onClose, onChanged }) {
  const [members, setMembers] = useState([]);
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [memberForm, setMemberForm] = useState({ userId: "" });
  const [formErrorMessage, setFormErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [isActing, setIsActing] = useState(false);
  const [togglingMemberId, setTogglingMemberId] = useState(null);
  const instanceId = instance?.id;
  const membersPath = `/api/admin/instances/${instanceId}/members`;

  async function loadMembers() {
    setIsLoading(true);
    try {
      const [membersResponse, usersResponse] = await Promise.all([
        requestJson(membersPath),
        requestJson("/api/admin/users"),
      ]);
      setMembers(membersResponse.data.members);
      setUsers(usersResponse.data.users);
    } catch (error) {
      showToast(error?.message || "读取访问成员失败", { type: "error" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!instanceId) {
      return;
    }
    setMembers([]);
    loadMembers();
  }, [instanceId]);

  async function refreshAfterChange() {
    await Promise.all([loadMembers(), onChanged()]);
  }

  function openBindingForm() {
    setEditingMember(null);
    setMemberForm({ userId: "" });
    setFormErrorMessage("");
    setIsFormOpen(true);
  }

  function openEditForm(member) {
    setEditingMember(member);
    setMemberForm(createMemberFormFromMember(member));
    setFormErrorMessage("");
    setIsFormOpen(true);
  }

  function updateMemberForm(fieldName, value) {
    setMemberForm((currentForm) => ({ ...currentForm, [fieldName]: value }));
  }

  async function saveMember(event) {
    event.preventDefault();
    if (!editingMember && !memberForm.userId) {
      return;
    }
    setFormErrorMessage("");
    setIsSaving(true);
    try {
      if (editingMember) {
        const responsePayload = await requestJson(`${membersPath}/${editingMember.id}`, {
          method: "PATCH",
          body: JSON.stringify(createMemberRequestBody(memberForm, editingMember.enabled)),
        });
        showToast(`成员“${responsePayload.data.member.name}”已更新`, { type: "success" });
      } else {
        const userId = Number(memberForm.userId);
        const baseName = `user-${userId}`;
        const reservedNames = new Set([
          instance.namePrefix,
          ...members.flatMap((member) => [member.name, member.namePrefix]),
        ]);
        let name = baseName;
        for (let suffix = 2; reservedNames.has(name); suffix += 1) {
          name = `${baseName}-${suffix}`;
        }
        await requestJson(membersPath, {
          method: "POST",
          body: JSON.stringify({ name, namePrefix: name, userId }),
        });
        showToast("用户已绑定到此实例", { type: "success" });
      }
      setIsFormOpen(false);
      await refreshAfterChange();
    } catch (error) {
      setFormErrorMessage(error?.message || (editingMember ? "保存成员失败" : "绑定用户失败"));
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleMember(member) {
    setTogglingMemberId(member.id);
    try {
      await requestJson(`${membersPath}/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify(createMemberRequestBody(createMemberFormFromMember(member), !member.enabled)),
      });
      showToast(member.enabled ? `已停用“${member.name}”，该账号不能再访问此实例` : `已启用“${member.name}”`, { type: "success" });
      await refreshAfterChange();
    } catch (error) {
      showToast(error?.message || "更新成员状态失败", { type: "error" });
    } finally {
      setTogglingMemberId(null);
    }
  }

  async function confirmPendingAction() {
    const member = pendingAction;
    setIsActing(true);
    try {
      await requestJson(`${membersPath}/${member.id}`, { method: "DELETE" });
      showToast(`成员“${member.name}”已删除`, { type: "success" });
      setPendingAction(null);
      await refreshAfterChange();
    } catch (error) {
      showToast(error?.message || "操作失败", { type: "error" });
    } finally {
      setIsActing(false);
    }
  }

  if (!instance) {
    return null;
  }

  return (
    <>
      <Sheet
        open
        title="访问成员"
        description={`${instance.name} · 管理该实例的用户访问、成员渠道前缀和导入记录归属。`}
        onClose={onClose}
        footer={(
          <>
            <button className="btn btn-outline" type="button" onClick={onClose}>
              关闭
            </button>
            <button className="btn btn-primary" type="button" onClick={openBindingForm} disabled={isLoading}>
              <Plus size={15} aria-hidden="true" />
              绑定用户
            </button>
          </>
        )}
      >
        <p className="callout callout-info member-defaults">
          实例默认值：<code>{formatChannelNamePattern(instance)}</code>
          {" "}· 优先级 {instance.priority} · 权重 {instance.weight}。成员未单独设置的项沿用这些值。
        </p>
        <div className="member-list" aria-busy={isLoading}>
          {members.map((member) => {
            const resolvedDefaults = resolveMemberDefaults(instance, member);
            return (
              <article className={`member-card ${member.enabled ? "" : "is-disabled"}`} key={member.id} aria-label={`成员 ${member.name}`}>
                <div className="member-card-head">
                  <div className="cell-stack">
                    <strong>{member.name}</strong>
                    <span className="cell-mono">{formatChannelNamePattern(resolvedDefaults)}</span>
                    <span>{users.find((user) => user.id === member.userId)?.username ?? "未绑定用户"}</span>
                  </div>
                  <div className="row-actions">
                    <Switch
                      checked={member.enabled}
                      disabled={togglingMemberId === member.id}
                      ariaLabel={member.enabled ? `停用成员 ${member.name}` : `启用成员 ${member.name}`}
                      onChange={() => toggleMember(member)}
                    />
                    <DropdownMenu
                      label={`${member.name} 的更多操作`}
                      items={[
                        { label: "编辑成员", icon: Pencil, onSelect: () => openEditForm(member) },
                        {
                          label: "删除成员",
                          icon: Trash2,
                          danger: true,
                          onSelect: () => setPendingAction(member),
                        },
                      ]}
                    />
                  </div>
                </div>
                <dl className="member-meta">
                  <div>
                    <dt>日期</dt>
                    <dd><InheritedValue value={describeDateMode(resolvedDefaults.dateMode)} inherited={member.dateMode === null} /></dd>
                  </div>
                  <div>
                    <dt>优先级 / 权重</dt>
                    <dd>
                      <InheritedValue value={resolvedDefaults.priority} inherited={member.priority === null} />
                      {" / "}
                      <InheritedValue value={resolvedDefaults.weight} inherited={member.weight === null} />
                    </dd>
                  </div>
                  <div>
                    <dt>导入记录</dt>
                    <dd>{member.channelRecordCount}</dd>
                  </div>
                  <div>
                    <dt>状态</dt>
                    <dd>{member.enabled ? "可进入" : "已停用"}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
        {isLoading && members.length === 0 ? (
          <p className="form-note member-loading"><Spinner /> 正在读取访问成员...</p>
        ) : null}
        {!isLoading && members.length === 0 ? (
          <EmptyState
            icon={Users}
            title="还没有访问成员"
            description="选择已有用户即可授予此实例的访问和推送权限。"
            action={(
              <button className="btn btn-primary" type="button" onClick={openBindingForm}>
                <Plus size={15} aria-hidden="true" />
                绑定用户
              </button>
            )}
          />
        ) : null}
      </Sheet>

      <Modal
        open={isFormOpen}
        title={editingMember ? "编辑成员" : "绑定用户"}
        size={editingMember ? "md" : "sm"}
        description={editingMember
          ? "修改后对之后导入的渠道生效，已创建的渠道不会改名。"
          : `选择可访问和推送到「${instance.name}」的用户。`}
        closeDisabled={isSaving}
        closeOnBackdrop={false}
        onClose={() => setIsFormOpen(false)}
        onSubmit={saveMember}
        footer={(
          <>
            <button className="btn btn-outline" type="button" disabled={isSaving} onClick={() => setIsFormOpen(false)}>
              取消
            </button>
            <button className="btn btn-primary" disabled={isSaving || (!editingMember && !memberForm.userId)}>
              {isSaving ? <Spinner /> : null}
              {isSaving ? "正在保存..." : editingMember ? "保存修改" : "确认绑定"}
            </button>
          </>
        )}
      >
        {editingMember ? (
          <MemberFormFields instance={instance} memberForm={memberForm} onChange={updateMemberForm}
            editingMember={editingMember} members={members} users={users} />
        ) : (
          <Field label="选择用户" hint={users.length === 0 ? "请先在用户管理中创建普通用户。" : undefined}>
            <Select required disabled={isSaving} value={memberForm.userId}
              onChange={(event) => updateMemberForm("userId", event.target.value)}>
              <option value="" disabled>请选择用户</option>
              {users.map((user) => {
                const boundMember = members.find((member) => member.userId === user.id);
                const statusLabel = !user.enabled ? "（账号已停用）"
                  : boundMember?.enabled ? "（已绑定）"
                    : boundMember ? "（在成员列表恢复访问）" : "";
                return (
                  <option key={user.id} value={user.id} disabled={!user.enabled || Boolean(boundMember)}>
                    {user.username}{statusLabel}
                  </option>
                );
              })}
            </Select>
          </Field>
        )}
        {formErrorMessage ? <p className="form-error">{formErrorMessage}</p> : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title="删除成员？"
        confirmLabel="确认删除"
        tone="danger"
        isBusy={isActing}
        onConfirm={confirmPendingAction}
        onCancel={() => setPendingAction(null)}
      >
        <p>
          删除“{pendingAction?.name}”后，绑定账号将失去该实例的访问权限。
        </p>
        {pendingAction?.channelRecordCount > 0 ? (
          <p className="callout callout-warning">
            已导入的 {pendingAction.channelRecordCount} 条渠道记录会保留，之后只有管理员能在 Key 记录中看到。
          </p>
        ) : null}
      </ConfirmDialog>

    </>
  );
}
