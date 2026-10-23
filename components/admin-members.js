"use client";

import { useEffect, useState } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  ShieldCheck,
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

const EMPTY_MEMBER_FORM = Object.freeze({
  name: "",
  namePrefix: "",
  dateChoice: DATE_CHOICES.INHERIT,
  fixedDate: "",
  startNumber: "",
  priority: "",
  weight: "",
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

function MemberFormFields({ instance, memberForm, onChange }) {
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
  const [isLoading, setIsLoading] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [memberForm, setMemberForm] = useState({ ...EMPTY_MEMBER_FORM });
  const [formErrorMessage, setFormErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [isActing, setIsActing] = useState(false);
  const [generatedAccess, setGeneratedAccess] = useState(null);
  const [revealedAccessKeys, setRevealedAccessKeys] = useState({});
  const [loadingKeyMemberId, setLoadingKeyMemberId] = useState(null);
  const [togglingMemberId, setTogglingMemberId] = useState(null);
  const instanceId = instance?.id;
  const membersPath = `/api/admin/instances/${instanceId}/members`;

  async function loadMembers() {
    setIsLoading(true);
    try {
      const responsePayload = await requestJson(membersPath);
      setMembers(responsePayload.data.members);
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
    setRevealedAccessKeys({});
    loadMembers();
  }, [instanceId]);

  async function refreshAfterChange() {
    await Promise.all([loadMembers(), onChanged()]);
  }

  function forgetRevealedAccessKey(memberId) {
    setRevealedAccessKeys((currentKeys) => {
      const remainingKeys = { ...currentKeys };
      delete remainingKeys[memberId];
      return remainingKeys;
    });
  }

  function openCreateForm() {
    setEditingMember(null);
    setMemberForm({ ...EMPTY_MEMBER_FORM });
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
    setFormErrorMessage("");
    setIsSaving(true);
    try {
      const responsePayload = await requestJson(
        editingMember ? `${membersPath}/${editingMember.id}` : membersPath,
        {
          method: editingMember ? "PATCH" : "POST",
          body: JSON.stringify(createMemberRequestBody(memberForm, editingMember?.enabled ?? true)),
        },
      );
      setIsFormOpen(false);
      if (editingMember) {
        showToast(`成员“${responsePayload.data.member.name}”已更新`, { type: "success" });
      } else {
        setGeneratedAccess({ ...responsePayload.data, isNewMember: true });
      }
      await refreshAfterChange();
    } catch (error) {
      setFormErrorMessage(error?.message || "保存成员失败");
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
      showToast(member.enabled ? `已停用“${member.name}”，其访客会话已失效` : `已启用“${member.name}”`, { type: "success" });
      await refreshAfterChange();
    } catch (error) {
      showToast(error?.message || "更新成员状态失败", { type: "error" });
    } finally {
      setTogglingMemberId(null);
    }
  }

  async function confirmPendingAction() {
    const { type, member } = pendingAction;
    setIsActing(true);
    try {
      if (type === "delete") {
        await requestJson(`${membersPath}/${member.id}`, { method: "DELETE" });
        showToast(`成员“${member.name}”已删除`, { type: "success" });
      } else {
        const responsePayload = await requestJson(`${membersPath}/${member.id}/access-key`, {
          method: "POST",
          body: "{}",
        });
        setGeneratedAccess({ member, accessKey: responsePayload.data.accessKey, isNewMember: false });
      }
      forgetRevealedAccessKey(member.id);
      setPendingAction(null);
      await refreshAfterChange();
    } catch (error) {
      showToast(error?.message || "操作失败", { type: "error" });
    } finally {
      setIsActing(false);
    }
  }

  async function loadAccessKey(member) {
    if (revealedAccessKeys[member.id]) {
      return revealedAccessKeys[member.id];
    }
    setLoadingKeyMemberId(member.id);
    try {
      const responsePayload = await requestJson(`${membersPath}/${member.id}/access-key/reveal`, {
        method: "POST",
        body: "{}",
      });
      const accessKey = responsePayload.data.accessKey;
      setRevealedAccessKeys((currentKeys) => ({ ...currentKeys, [member.id]: accessKey }));
      return accessKey;
    } catch (error) {
      showToast(error?.message || "读取访问 Key 失败", { type: "error" });
      return null;
    } finally {
      setLoadingKeyMemberId(null);
    }
  }

  async function copyAccessKey(accessKey) {
    if (!accessKey) {
      return;
    }
    try {
      await navigator.clipboard.writeText(accessKey);
      showToast("完整访问 Key 已复制", { type: "success" });
    } catch {
      showToast("复制访问 Key 失败，请检查浏览器权限", { type: "error" });
    }
  }

  if (!instance) {
    return null;
  }
  const isPendingDelete = pendingAction?.type === "delete";

  return (
    <>
      <Sheet
        open
        title="访问成员"
        description={`${instance.name} · 每个成员持有独立的访问 Key 和渠道前缀，只能看到自己导入的渠道。`}
        onClose={onClose}
        footer={(
          <>
            <button className="btn btn-outline" type="button" onClick={onClose}>
              关闭
            </button>
            <button className="btn btn-primary" type="button" onClick={openCreateForm}>
              <Plus size={15} aria-hidden="true" />
              新增成员
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
            const revealedKey = revealedAccessKeys[member.id];
            return (
              <article className={`member-card ${member.enabled ? "" : "is-disabled"}`} key={member.id} aria-label={`成员 ${member.name}`}>
                <div className="member-card-head">
                  <div className="cell-stack">
                    <strong>{member.name}</strong>
                    <span className="cell-mono">{formatChannelNamePattern(resolvedDefaults)}</span>
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
                          label: "重新生成访问 Key",
                          icon: KeyRound,
                          onSelect: () => setPendingAction({ type: "regenerate", member }),
                        },
                        {
                          label: "删除成员",
                          icon: Trash2,
                          danger: true,
                          onSelect: () => setPendingAction({ type: "delete", member }),
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
                <div className="key-cell member-key">
                  <KeyRound size={14} aria-hidden="true" />
                  <span className="cell-mono key-value">{revealedKey || member.accessKey.mask || "未生成"}</span>
                  {member.accessKey.revealable ? (
                    <>
                      <button
                        className="btn btn-ghost btn-icon btn-xs"
                        type="button"
                        title={revealedKey ? "隐藏访问 Key" : "显示访问 Key"}
                        aria-label={revealedKey ? `隐藏 ${member.name} 的访问 Key` : `显示 ${member.name} 的访问 Key`}
                        disabled={loadingKeyMemberId === member.id}
                        onClick={() => (revealedKey ? forgetRevealedAccessKey(member.id) : loadAccessKey(member))}
                      >
                        {revealedKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button
                        className="btn btn-ghost btn-icon btn-xs"
                        type="button"
                        title="复制访问 Key"
                        aria-label={`复制 ${member.name} 的访问 Key`}
                        disabled={loadingKeyMemberId === member.id}
                        onClick={async () => copyAccessKey(await loadAccessKey(member))}
                      >
                        <Copy size={14} />
                      </button>
                    </>
                  ) : member.accessKey.configured ? (
                    <span className="tag tag-muted" title="该访问 Key 生成于加密保存之前，重新生成一次后即可随时查看">
                      重新生成后可查看
                    </span>
                  ) : null}
                </div>
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
            description="为每位使用者新增一个成员，分别发放访问 Key，并让他们的渠道使用各自的名称前缀。"
            action={(
              <button className="btn btn-primary" type="button" onClick={openCreateForm}>
                <Plus size={15} aria-hidden="true" />
                新增成员
              </button>
            )}
          />
        ) : null}
      </Sheet>

      <Modal
        open={isFormOpen}
        title={editingMember ? "编辑成员" : "新增成员"}
        description={editingMember
          ? "修改后对之后导入的渠道生效，已创建的渠道不会改名。"
          : "保存后会生成该成员专属的访问 Key。"}
        closeDisabled={isSaving}
        closeOnBackdrop={false}
        onClose={() => setIsFormOpen(false)}
        onSubmit={saveMember}
        footer={(
          <>
            <button className="btn btn-outline" type="button" disabled={isSaving} onClick={() => setIsFormOpen(false)}>
              取消
            </button>
            <button className="btn btn-primary" disabled={isSaving}>
              {isSaving ? <Spinner /> : null}
              {isSaving ? "正在保存..." : editingMember ? "保存修改" : "创建并生成 Key"}
            </button>
          </>
        )}
      >
        <MemberFormFields instance={instance} memberForm={memberForm} onChange={updateMemberForm} />
        {formErrorMessage ? <p className="form-error">{formErrorMessage}</p> : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={isPendingDelete ? "删除成员？" : "重新生成访问 Key？"}
        confirmLabel={isPendingDelete ? "确认删除" : "确认重新生成"}
        tone={isPendingDelete ? "danger" : "primary"}
        isBusy={isActing}
        onConfirm={confirmPendingAction}
        onCancel={() => setPendingAction(null)}
      >
        <p>
          {isPendingDelete
            ? `删除“${pendingAction?.member.name}”后，其访问 Key 和访客会话立即失效。`
            : `重新生成后，“${pendingAction?.member.name}”的旧访问 Key 和现有访客会话将立即失效。`}
        </p>
        {isPendingDelete && pendingAction?.member.channelRecordCount > 0 ? (
          <p className="callout callout-warning">
            已导入的 {pendingAction.member.channelRecordCount} 条渠道记录会保留，之后只有管理员能在 Key 记录中看到。
          </p>
        ) : null}
      </ConfirmDialog>

      <Modal
        open={Boolean(generatedAccess)}
        title={generatedAccess?.isNewMember ? "成员已创建" : "访问 Key 已重新生成"}
        description={generatedAccess ? `成员：${generatedAccess.member.name}` : undefined}
        size="sm"
        closeOnBackdrop={false}
        onClose={() => setGeneratedAccess(null)}
        footer={(
          <>
            <button className="btn btn-outline" type="button" onClick={() => setGeneratedAccess(null)}>
              完成
            </button>
            <button className="btn btn-primary" type="button" onClick={() => copyAccessKey(generatedAccess?.accessKey)}>
              <Copy size={15} aria-hidden="true" />
              复制 Key
            </button>
          </>
        )}
      >
        <div className="secret-box">
          <ShieldCheck size={16} aria-hidden="true" />
          <code>{generatedAccess?.accessKey}</code>
        </div>
        <p className="callout callout-info">
          {generatedAccess?.isNewMember
            ? "把这个 Key 发给该成员即可。Key 已加密保存，之后可在成员列表中随时查看或复制。"
            : "旧 Key 和该成员现有的访客会话已失效，请把新 Key 发给该成员。"}
        </p>
      </Modal>
    </>
  );
}
