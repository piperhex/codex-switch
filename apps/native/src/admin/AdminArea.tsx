import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ActivityIndicator, Button, Card, Modal, Switch, Tag, Toast } from '@ant-design/react-native';
import { adminRequest } from '../api/client';
import type {
  AdminDashboardOverview,
  AdminFeedback,
  AdminInvitation,
  AdminOfficialAccount,
  AdminRole,
  AdminUser,
  AuthSession,
  PageResult,
  UserProfile,
} from '../types';

type AdminPage = 'home' | 'dashboard' | 'officialAccounts' | 'invitations' | 'feedback' | 'users';

interface AdminAreaProps {
  session: AuthSession;
  profile: UserProfile;
}

const EMPTY_PAGE = { items: [], total: 0, page: 1, pageSize: 20 };

const entries: Array<{ key: Exclude<AdminPage, 'home'>; title: string; subtitle: string; icon: string; color: string }> = [
  { key: 'dashboard', title: '仪表盘', subtitle: '运营数据概览', icon: '◫', color: '#e8f2ff' },
  { key: 'officialAccounts', title: '官方账号池', subtitle: '账号与绑定管理', icon: '◎', color: '#e9f8f3' },
  { key: 'invitations', title: '邀请注册', subtitle: '邀请码与使用记录', icon: '✉', color: '#fff3df' },
  { key: 'feedback', title: '问题反馈', subtitle: '查看并回复反馈', icon: '◌', color: '#f2ecff' },
  { key: 'users', title: '用户管理', subtitle: '用户、角色与状态', icon: '♙', color: '#ffecee' },
];

const titles: Record<AdminPage, string> = {
  home: '管理员', dashboard: '仪表盘', officialAccounts: '官方账号池', invitations: '邀请注册', feedback: '问题反馈', users: '用户管理',
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后重试';
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function has(profile: UserProfile, permission: string) {
  return profile.role === 'admin' && (profile.permissions?.includes(permission) ?? true);
}

function PageShell({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return <View style={styles.flex}>
    <View style={styles.pageHeader}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回管理员首页" hitSlop={10} onPress={onBack} style={styles.backButton}>
        <Text style={styles.backText}>‹ 返回</Text>
      </Pressable>
      <Text style={styles.pageTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
    {children}
  </View>;
}

function Toolbar({ total, loading, onRefresh, children }: {
  total?: number; loading: boolean; onRefresh: () => void; children?: ReactNode;
}) {
  return <View style={styles.toolbar}>
    <Text style={styles.toolbarText}>{total === undefined ? '管理后台' : `共 ${total} 条`}</Text>
    <View style={styles.toolbarActions}>
      <Button size="small" loading={loading} onPress={onRefresh}>刷新</Button>
      {children}
    </View>
  </View>;
}

function Pager({ value, onChange }: { value: PageResult<unknown>; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(value.total / value.pageSize));
  if (pages <= 1) return null;
  return <View style={styles.pager}>
    <Button size="small" disabled={value.page <= 1} onPress={() => onChange(value.page - 1)}>上一页</Button>
    <Text style={styles.pagerText}>{value.page} / {pages}</Text>
    <Button size="small" disabled={value.page >= pages} onPress={() => onChange(value.page + 1)}>下一页</Button>
  </View>;
}

function LoadingOrEmpty({ loading, empty, children }: { loading: boolean; empty: boolean; children: ReactNode }) {
  if (loading) return <View style={styles.stateBox}><ActivityIndicator text="加载中…" /></View>;
  if (empty) return <View style={styles.stateBox}><Text style={styles.emptyText}>暂无数据</Text></View>;
  return <>{children}</>;
}

function Field({ label, value, onChangeText, placeholder, secureTextEntry, multiline, keyboardType }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; secureTextEntry?: boolean; multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric';
}) {
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#9aa8a0"
      secureTextEntry={secureTextEntry} multiline={multiline} keyboardType={keyboardType}
      autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
      style={[styles.input, multiline && styles.textarea]} />
  </View>;
}

function AdminHome({ onOpen }: { onOpen: (page: AdminPage) => void }) {
  return <ScrollView contentContainerStyle={styles.homeScroll}>
    <View style={styles.homeHeading}>
      <Text style={styles.homeTitle}>管理后台</Text>
      <Text style={styles.homeSubtitle}>选择要管理的功能</Text>
    </View>
    <View style={styles.entryGrid}>
      {entries.map((entry) => <Pressable key={entry.key} accessibilityRole="button" onPress={() => onOpen(entry.key)}
        style={({ pressed }) => [styles.entryCard, pressed && styles.pressed]}>
        <View style={[styles.entryIcon, { backgroundColor: entry.color }]}><Text style={styles.entryIconText}>{entry.icon}</Text></View>
        <Text style={styles.entryTitle}>{entry.title}</Text>
        <Text style={styles.entrySubtitle}>{entry.subtitle}</Text>
      </Pressable>)}
    </View>
  </ScrollView>;
}

function DashboardPage({ session, onBack }: AdminAreaProps & { onBack: () => void }) {
  const [data, setData] = useState<AdminDashboardOverview | null>(null);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await adminRequest(session, `/admin/api/dashboard/overview?days=${days}`)); }
    catch (error) { Toast.fail(messageOf(error)); }
    finally { setLoading(false); }
  }, [days, session]);
  useEffect(() => { void load(); }, [load]);
  const metrics = [
    ['用户总数', data?.summary.totalUsers ?? 0, `活跃 ${data?.summary.activeUsers ?? 0} · 新增 ${data?.summary.newUsers ?? 0}`],
    ['设备安装', data?.summary.totalInstallations ?? 0, `新增 ${data?.summary.newInstallations ?? 0}`],
    ['官方账号', data?.summary.officialAccounts ?? 0, `已绑定 ${data?.summary.boundOfficialAccounts ?? 0}`],
    ['待处理事项', (data?.summary.pendingFeedback ?? 0) + (data?.summary.pendingApprovals ?? 0), `反馈 ${data?.summary.pendingFeedback ?? 0} · 审批 ${data?.summary.pendingApprovals ?? 0}`],
  ] as const;
  return <PageShell title={titles.dashboard} onBack={onBack}>
    <ScrollView contentContainerStyle={styles.pageScroll} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
      <View style={styles.periodRow}>{([7, 30, 90] as const).map((item) => <Button key={item} size="small" type={days === item ? 'primary' : 'ghost'} onPress={() => setDays(item)}>{item} 天</Button>)}</View>
      <View style={styles.metricGrid}>{metrics.map(([label, value, note]) => <View key={label} style={styles.metricCard}>
        <Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricNote}>{note}</Text>
      </View>)}</View>
      <Card style={styles.card}><Card.Header title="增长趋势" extra={data ? `${data.range.startDate} 至 ${data.range.endDate}` : ''} /><Card.Body>
        {data?.trend.slice(-10).map((item) => <View key={item.date} style={styles.dataRow}><Text style={styles.dataLabel}>{item.date}</Text><Text style={styles.dataValue}>用户 +{item.users}　设备 +{item.installations}</Text></View>)}
      </Card.Body></Card>
      <Card style={styles.card}><Card.Header title="平台分布" /><Card.Body>
        {data?.platforms.map((item) => <View key={item.name} style={styles.dataRow}><Text style={styles.dataLabel}>{item.name}</Text><Text style={styles.dataValue}>{item.value}</Text></View>)}
      </Card.Body></Card>
    </ScrollView>
  </PageShell>;
}

function OfficialAccountsPage({ session, profile, onBack }: AdminAreaProps & { onBack: () => void }) {
  const [data, setData] = useState<PageResult<AdminOfficialAccount>>(EMPTY_PAGE);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AdminOfficialAccount | 'new' | null>(null);
  const [authJson, setAuthJson] = useState('');
  const [note, setNote] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [binding, setBinding] = useState<AdminOfficialAccount | null>(null);
  const [bindingUsers, setBindingUsers] = useState<AdminUser[]>([]);
  const [boundIds, setBoundIds] = useState<string[]>([]);
  const [initialBoundIds, setInitialBoundIds] = useState<string[]>([]);
  const canManage = has(profile, 'admin.official-accounts.manage');
  const load = useCallback(async (page = data.page) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: String(data.pageSize) });
      if (search.trim()) query.set('search', search.trim());
      setData(await adminRequest(session, `/admin/api/official-accounts?${query}`));
    } catch (error) { Toast.fail(messageOf(error)); }
    finally { setLoading(false); }
  }, [data.page, data.pageSize, search, session]);
  useEffect(() => { void load(1); }, [session]);

  function openEditor(account: AdminOfficialAccount | 'new') {
    setEditing(account); setAuthJson(''); setNote(account === 'new' ? '' : account.note ?? ''); setExpiresAt(account === 'new' ? '' : account.expiresAt ?? '');
  }
  async function save() {
    const body: Record<string, unknown> = { note, expiresAt };
    if (authJson.trim()) {
      try { body.auth = JSON.parse(authJson.replace(/^\uFEFF/, '')); }
      catch { Toast.fail('auth.json 内容不是有效 JSON'); return; }
    } else if (editing === 'new') { Toast.fail('请填写 auth.json'); return; }
    setSaving(true);
    try {
      await adminRequest(session, editing === 'new' ? '/admin/api/official-accounts' : `/admin/api/official-accounts/${editing?.id}`, {
        method: editing === 'new' ? 'POST' : 'PATCH', body: JSON.stringify(body),
      });
      Toast.success(editing === 'new' ? '账号已添加' : '账号已更新'); setEditing(null); await load(editing === 'new' ? 1 : data.page);
    } catch (error) { Toast.fail(messageOf(error)); }
    finally { setSaving(false); }
  }
  function remove(account: AdminOfficialAccount) {
    Alert.alert('删除官方账号', `确定删除 ${account.email}？此操作无法撤销。`, [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void (async () => {
      try { await adminRequest(session, `/admin/api/official-accounts/${account.id}`, { method: 'DELETE' }); Toast.success('已删除'); await load(); }
      catch (error) { Toast.fail(messageOf(error)); }
    })() }]);
  }
  async function openBindings(account: AdminOfficialAccount) {
    setBinding(account);
    try {
      const [users, bound] = await Promise.all([
        adminRequest<PageResult<AdminUser>>(session, '/admin/api/users?page=1&pageSize=100'),
        adminRequest<{ userIds: string[] }>(session, `/admin/api/official-accounts/${account.id}/bindings`),
      ]);
      setBindingUsers(users.items); setBoundIds(bound.userIds); setInitialBoundIds(bound.userIds);
    } catch (error) { setBinding(null); Toast.fail(messageOf(error)); }
  }
  async function saveBindings() {
    if (!binding) return;
    const added = boundIds.filter((id) => !initialBoundIds.includes(id));
    const removed = initialBoundIds.filter((id) => !boundIds.includes(id));
    setSaving(true);
    try {
      if (added.length) await adminRequest(session, '/admin/api/official-accounts/bind', { method: 'POST', body: JSON.stringify({ systemAccountIds: [binding.id], userIds: added }) });
      if (removed.length) await adminRequest(session, '/admin/api/official-accounts/unbind', { method: 'POST', body: JSON.stringify({ systemAccountIds: [binding.id], userIds: removed }) });
      Toast.success('绑定已更新'); setBinding(null); await load();
    } catch (error) { Toast.fail(messageOf(error)); }
    finally { setSaving(false); }
  }

  return <PageShell title={titles.officialAccounts} onBack={onBack}>
    <View style={styles.searchRow}><TextInput value={search} onChangeText={setSearch} onSubmitEditing={() => void load(1)} placeholder="搜索邮箱、备注或账号 ID" style={styles.searchInput} /><Button size="small" onPress={() => void load(1)}>搜索</Button></View>
    <Toolbar total={data.total} loading={loading} onRefresh={() => void load()}>{canManage && <Button size="small" type="primary" onPress={() => openEditor('new')}>新增</Button>}</Toolbar>
    <ScrollView contentContainerStyle={styles.listScroll}><LoadingOrEmpty loading={loading} empty={!data.items.length}>{data.items.map((account) => <Card key={account.id} style={styles.card}>
      <Card.Header title={account.email} extra={`${account.boundUserCount} 个绑定`} /><Card.Body>
        <View style={styles.tagRow}><Tag>{account.plan || 'ChatGPT'}</Tag>{account.expiresAt ? <Tag>{account.expiresAt}</Tag> : null}</View>
        <Text style={styles.bodyText}>{account.note || '暂无备注'}</Text>
        <Text style={styles.mutedText}>更新于 {formatDate(account.updatedAt)}</Text>
        {canManage && <View style={styles.actionRow}><Button size="small" onPress={() => openEditor(account)}>编辑</Button><Button size="small" onPress={() => void openBindings(account)}>绑定用户</Button><Button size="small" type="warning" onPress={() => remove(account)}>删除</Button></View>}
      </Card.Body>
    </Card>)}</LoadingOrEmpty><Pager value={data} onChange={(page) => void load(page)} /></ScrollView>
    <Modal visible={Boolean(editing)} title={editing === 'new' ? '新增官方账号' : '编辑官方账号'} transparent maskClosable={false} onClose={() => setEditing(null)}
      footer={[{ text: '取消', onPress: () => setEditing(null) }, { text: saving ? '保存中…' : '保存', onPress: save }]}>
      <ScrollView style={styles.modalScroll}><Field label="auth.json" value={authJson} onChangeText={setAuthJson} placeholder={editing === 'new' ? '{"tokens":{"access_token":"..."}}' : '留空表示不修改凭据'} multiline /><Field label="备注" value={note} onChangeText={setNote} /><Field label="到期日期" value={expiresAt} onChangeText={setExpiresAt} placeholder="YYYY-MM-DD" /></ScrollView>
    </Modal>
    <Modal visible={Boolean(binding)} title="绑定用户" transparent onClose={() => setBinding(null)} footer={[{ text: '取消', onPress: () => setBinding(null) }, { text: saving ? '保存中…' : '保存', onPress: saveBindings }]}>
      <ScrollView style={styles.bindingList}>{bindingUsers.map((user) => { const checked = boundIds.includes(user.id); return <Pressable key={user.id} onPress={() => setBoundIds((ids) => checked ? ids.filter((id) => id !== user.id) : [...ids, user.id])} style={styles.checkRow}><Text style={[styles.checkbox, checked && styles.checkboxChecked]}>{checked ? '✓' : ''}</Text><Text style={styles.checkLabel}>{user.email}</Text></Pressable>; })}</ScrollView>
    </Modal>
  </PageShell>;
}

function InvitationsPage({ session, profile, onBack }: AdminAreaProps & { onBack: () => void }) {
  const [data, setData] = useState<PageResult<AdminInvitation>>(EMPTY_PAGE);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState(''); const [role, setRole] = useState('user'); const [maxUses, setMaxUses] = useState('1'); const [hours, setHours] = useState('72'); const [neverExpires, setNeverExpires] = useState(false);
  const [usersInvite, setUsersInvite] = useState<AdminInvitation | null>(null);
  const [registeredUsers, setRegisteredUsers] = useState<Array<{ id: string; email: string; role: string; giftedAccountCount: number; registeredAt: string }>>([]);
  const canManage = has(profile, 'admin.invitations.manage');
  const load = useCallback(async (page = data.page) => {
    setLoading(true); try { setData(await adminRequest(session, `/admin/api/invitations?page=${page}&pageSize=${data.pageSize}`)); } catch (error) { Toast.fail(messageOf(error)); } finally { setLoading(false); }
  }, [data.page, data.pageSize, session]);
  useEffect(() => { void load(1); }, [session]);
  async function create() {
    try {
      const invitation = await adminRequest<AdminInvitation & { token?: string }>(session, '/admin/api/invitations', { method: 'POST', body: JSON.stringify({ email: email.trim() || undefined, role, maxUses: Number(maxUses), neverExpires, expiresInHours: neverExpires ? undefined : Number(hours) }) });
      setCreating(false); await load(1);
      if (invitation.token) { const link = `${session.baseUrl}/admin?inviteToken=${encodeURIComponent(invitation.token)}`; await Clipboard.setStringAsync(link); Alert.alert('邀请已创建', `注册链接已复制：\n${link}`); }
    } catch (error) { Toast.fail(messageOf(error)); }
  }
  async function copy(item: AdminInvitation) {
    try { const result = await adminRequest<{ token: string }>(session, `/admin/api/invitations/${item.id}/token`, { method: 'POST' }); await Clipboard.setStringAsync(`${session.baseUrl}/admin?inviteToken=${encodeURIComponent(result.token)}`); Toast.success('注册链接已复制'); }
    catch (error) { Toast.fail(messageOf(error)); }
  }
  async function openRegisteredUsers(item: AdminInvitation) {
    setUsersInvite(item); setRegisteredUsers([]);
    try {
      const result = await adminRequest<PageResult<{ id: string; email: string; role: string; giftedAccountCount: number; registeredAt: string }>>(session, `/admin/api/invitations/${item.id}/users?page=1&pageSize=100`);
      setRegisteredUsers(result.items);
    } catch (error) { setUsersInvite(null); Toast.fail(messageOf(error)); }
  }
  function revoke(item: AdminInvitation) { Alert.alert('撤销邀请', '撤销后该注册链接将立即失效。', [{ text: '取消', style: 'cancel' }, { text: '撤销', style: 'destructive', onPress: () => void (async () => { try { await adminRequest(session, `/admin/api/invitations/${item.id}`, { method: 'DELETE' }); Toast.success('已撤销'); await load(); } catch (error) { Toast.fail(messageOf(error)); } })() }]); }
  const status = (item: AdminInvitation) => item.revokedAt ? '已撤销' : item.usedCount >= item.maxUses ? '已用完' : item.expiresAt && new Date(item.expiresAt) <= new Date() ? '已过期' : '有效';
  return <PageShell title={titles.invitations} onBack={onBack}>
    <Toolbar total={data.total} loading={loading} onRefresh={() => void load()}>{canManage && <Button size="small" type="primary" onPress={() => setCreating(true)}>创建邀请</Button>}</Toolbar>
    <ScrollView contentContainerStyle={styles.listScroll}><LoadingOrEmpty loading={loading} empty={!data.items.length}>{data.items.map((item) => <Card key={item.id} style={styles.card}><Card.Header title={item.email || '任意邮箱'} extra={status(item)} /><Card.Body>
      <View style={styles.tagRow}><Tag>{item.role}</Tag><Tag>{item.usedCount}/{item.maxUses} 次</Tag></View><Text style={styles.bodyText}>创建人：{item.createdByEmail}</Text><Text style={styles.mutedText}>到期：{item.expiresAt ? formatDate(item.expiresAt) : '永不过期'}</Text>
      <View style={styles.actionRow}><Button size="small" onPress={() => void openRegisteredUsers(item)}>注册用户</Button>{canManage && <><Button size="small" disabled={status(item) !== '有效'} onPress={() => void copy(item)}>复制链接</Button><Button size="small" type="warning" disabled={status(item) !== '有效'} onPress={() => revoke(item)}>撤销</Button></>}</View>
    </Card.Body></Card>)}</LoadingOrEmpty><Pager value={data} onChange={(page) => void load(page)} /></ScrollView>
    <Modal visible={creating} title="创建邀请" transparent onClose={() => setCreating(false)} footer={[{ text: '取消', onPress: () => setCreating(false) }, { text: '创建', onPress: create }]}>
      <ScrollView style={styles.modalScroll}><Field label="指定邮箱（可选）" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="留空允许任意邮箱" /><Field label="角色" value={role} onChangeText={setRole} placeholder="user" /><Field label="最大使用次数" value={maxUses} onChangeText={setMaxUses} keyboardType="numeric" />
        <View style={styles.switchRow}><Text style={styles.fieldLabel}>永不过期</Text><Switch checked={neverExpires} onChange={setNeverExpires} /></View>{!neverExpires && <Field label="有效小时数" value={hours} onChangeText={setHours} keyboardType="numeric" />}</ScrollView>
    </Modal>
    <Modal visible={Boolean(usersInvite)} title="已注册用户" transparent onClose={() => setUsersInvite(null)} footer={[{ text: '关闭', onPress: () => setUsersInvite(null) }]}>
      <ScrollView style={styles.modalScroll}>{registeredUsers.length ? registeredUsers.map((user) => <View key={user.id} style={styles.registeredUserRow}><View style={styles.flex}><Text style={styles.fileName}>{user.email}</Text><Text style={styles.mutedText}>{user.role} · {formatDate(user.registeredAt)}</Text></View><Tag>{user.giftedAccountCount} 个赠送账号</Tag></View>) : <View style={styles.stateBox}><Text style={styles.emptyText}>暂无注册用户</Text></View>}</ScrollView>
    </Modal>
  </PageShell>;
}

function FeedbackPage({ session, profile, onBack }: AdminAreaProps & { onBack: () => void }) {
  const [data, setData] = useState<PageResult<AdminFeedback>>(EMPTY_PAGE); const [loading, setLoading] = useState(false); const [selected, setSelected] = useState<AdminFeedback | null>(null); const [replying, setReplying] = useState<AdminFeedback | null>(null); const [subject, setSubject] = useState('Codex Switch 问题反馈回复'); const [content, setContent] = useState('');
  const canManage = has(profile, 'admin.feedback.manage');
  const load = useCallback(async (page = data.page) => { setLoading(true); try { setData(await adminRequest(session, `/admin/api/feedback?page=${page}&pageSize=${data.pageSize}`)); } catch (error) { Toast.fail(messageOf(error)); } finally { setLoading(false); } }, [data.page, data.pageSize, session]);
  useEffect(() => { void load(1); }, [session]);
  async function sendReply() { if (!replying || !subject.trim() || !content.trim()) { Toast.fail('请填写主题和回复内容'); return; } try { await adminRequest(session, `/admin/api/feedback/${replying.id}/email`, { method: 'POST', body: JSON.stringify({ subject, content }) }); Toast.success('邮件已发送'); setReplying(null); setContent(''); await load(); } catch (error) { Toast.fail(messageOf(error)); } }
  return <PageShell title={titles.feedback} onBack={onBack}>
    <Toolbar total={data.total} loading={loading} onRefresh={() => void load()} />
    <ScrollView contentContainerStyle={styles.listScroll}><LoadingOrEmpty loading={loading} empty={!data.items.length}>{data.items.map((item) => <Card key={item.id} style={styles.card}><Card.Header title={item.email || '匿名用户'} extra={item.lastRepliedAt ? '已回复' : '未回复'} /><Card.Body>
      <Text style={styles.feedbackContent} numberOfLines={3}>{item.content}</Text><View style={styles.tagRow}><Tag>v{item.version}</Tag><Tag>{item.platform}</Tag>{item.attachments.length ? <Tag>{item.attachments.length} 个附件</Tag> : null}</View><Text style={styles.mutedText}>{formatDate(item.createdAt)}</Text>
      <View style={styles.actionRow}><Button size="small" onPress={() => setSelected(item)}>查看详情</Button>{canManage && item.email && <Button size="small" type="primary" onPress={() => setReplying(item)}>邮件回复</Button>}</View>
    </Card.Body></Card>)}</LoadingOrEmpty><Pager value={data} onChange={(page) => void load(page)} /></ScrollView>
    <Modal visible={Boolean(selected)} title="反馈详情" transparent onClose={() => setSelected(null)} footer={[{ text: '关闭', onPress: () => setSelected(null) }]}><ScrollView style={styles.modalScroll}>{selected && <><Text style={styles.detailMeta}>{selected.email || '匿名'} · {selected.platform} · v{selected.version}</Text><Text style={styles.detailContent}>{selected.content}</Text>{selected.attachments.map((file) => <View key={file.id} style={styles.fileRow}><Text style={styles.fileName}>{file.fileName}</Text><Text style={styles.mutedText}>{(file.size / 1024 / 1024).toFixed(2)} MB</Text></View>)}</>}</ScrollView></Modal>
    <Modal visible={Boolean(replying)} title={`回复 ${replying?.email ?? ''}`} transparent onClose={() => setReplying(null)} footer={[{ text: '取消', onPress: () => setReplying(null) }, { text: '发送', onPress: sendReply }]}><ScrollView style={styles.modalScroll}><Field label="邮件主题" value={subject} onChangeText={setSubject} /><Field label="回复内容" value={content} onChangeText={setContent} multiline /></ScrollView></Modal>
  </PageShell>;
}

function UsersPage({ session, profile, onBack }: AdminAreaProps & { onBack: () => void }) {
  const [data, setData] = useState<PageResult<AdminUser>>(EMPTY_PAGE); const [roles, setRoles] = useState<AdminRole[]>([]); const [loading, setLoading] = useState(false); const [search, setSearch] = useState(''); const [editing, setEditing] = useState<AdminUser | 'new' | null>(null); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [role, setRole] = useState('user'); const [disabled, setDisabled] = useState(false);
  const canManage = has(profile, 'admin.users.manage');
  const load = useCallback(async (page = data.page) => { setLoading(true); try { const query = new URLSearchParams({ page: String(page), pageSize: String(data.pageSize) }); if (search.trim()) query.set('search', search.trim()); setData(await adminRequest(session, `/admin/api/users?${query}`)); } catch (error) { Toast.fail(messageOf(error)); } finally { setLoading(false); } }, [data.page, data.pageSize, search, session]);
  useEffect(() => { void load(1); if (has(profile, 'admin.roles.read')) void adminRequest<AdminRole[]>(session, '/admin/api/roles').then(setRoles).catch(() => undefined); }, [session]);
  function openEditor(user: AdminUser | 'new') { setEditing(user); setEmail(user === 'new' ? '' : user.email); setPassword(''); setRole(user === 'new' ? 'user' : user.role); setDisabled(user === 'new' ? false : user.disabled); }
  async function save() { if (!email.trim() || (editing === 'new' && password.length < 8) || (editing !== 'new' && password.length > 0 && password.length < 8)) { Toast.fail('请填写有效邮箱，密码至少 8 位'); return; } try { const body = { email: email.trim(), role, disabled, ...(password ? { password } : {}) }; await adminRequest(session, editing === 'new' ? '/admin/api/users' : `/admin/api/users/${editing?.id}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: JSON.stringify(body) }); Toast.success(editing === 'new' ? '用户已创建' : '用户已更新'); setEditing(null); await load(editing === 'new' ? 1 : data.page); } catch (error) { Toast.fail(messageOf(error)); } }
  function remove(user: AdminUser) { Alert.alert('删除用户', `确定永久删除 ${user.email}？`, [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void (async () => { try { await adminRequest(session, `/admin/api/users/${user.id}`, { method: 'DELETE' }); Toast.success('已删除'); await load(); } catch (error) { Toast.fail(messageOf(error)); } })() }]); }
  return <PageShell title={titles.users} onBack={onBack}>
    <View style={styles.searchRow}><TextInput value={search} onChangeText={setSearch} onSubmitEditing={() => void load(1)} placeholder="搜索邮箱" style={styles.searchInput} /><Button size="small" onPress={() => void load(1)}>搜索</Button></View>
    <Toolbar total={data.total} loading={loading} onRefresh={() => void load()}>{canManage && <Button size="small" type="primary" onPress={() => openEditor('new')}>新增</Button>}</Toolbar>
    <ScrollView contentContainerStyle={styles.listScroll}><LoadingOrEmpty loading={loading} empty={!data.items.length}>{data.items.map((user) => <Card key={user.id} style={styles.card}><Card.Header title={user.email} extra={user.disabled ? '已禁用' : '正常'} /><Card.Body><View style={styles.tagRow}><Tag>{roles.find((item) => item.code === user.role)?.name ?? user.role}</Tag></View><Text style={styles.mutedText}>最后登录：{formatDate(user.lastLoginAt)}</Text>{canManage && <View style={styles.actionRow}><Button size="small" onPress={() => openEditor(user)}>编辑</Button><Button size="small" type="warning" onPress={() => remove(user)}>删除</Button></View>}</Card.Body></Card>)}</LoadingOrEmpty><Pager value={data} onChange={(page) => void load(page)} /></ScrollView>
    <Modal visible={Boolean(editing)} title={editing === 'new' ? '新增用户' : '编辑用户'} transparent onClose={() => setEditing(null)} footer={[{ text: '取消', onPress: () => setEditing(null) }, { text: '保存', onPress: save }]}><ScrollView style={styles.modalScroll}><Field label="邮箱" value={email} onChangeText={setEmail} keyboardType="email-address" /><Field label={editing === 'new' ? '初始密码' : '重置密码（可选）'} value={password} onChangeText={setPassword} secureTextEntry placeholder={editing === 'new' ? '至少 8 位' : '留空表示不修改'} /><Field label="角色代码" value={role} onChangeText={setRole} placeholder="user" />{roles.length > 0 && <View style={styles.roleChoices}>{roles.map((item) => <Button key={item.code} size="small" type={role === item.code ? 'primary' : 'ghost'} onPress={() => setRole(item.code)}>{item.name}</Button>)}</View>}<View style={styles.switchRow}><Text style={styles.fieldLabel}>禁用用户</Text><Switch checked={disabled} onChange={setDisabled} /></View></ScrollView></Modal>
  </PageShell>;
}

export function AdminArea({ session, profile }: AdminAreaProps) {
  const [page, setPage] = useState<AdminPage>('home');
  const props = useMemo(() => ({ session, profile, onBack: () => setPage('home') }), [profile, session]);
  if (page === 'home') return <AdminHome onOpen={setPage} />;
  if (page === 'dashboard') return <DashboardPage {...props} />;
  if (page === 'officialAccounts') return <OfficialAccountsPage {...props} />;
  if (page === 'invitations') return <InvitationsPage {...props} />;
  if (page === 'feedback') return <FeedbackPage {...props} />;
  return <UsersPage {...props} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, pressed: { opacity: 0.75 },
  pageHeader: { height: 52, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#dbe5de', backgroundColor: '#fff', paddingHorizontal: 12 },
  backButton: { width: 82, height: 42, justifyContent: 'center' }, backText: { color: '#1677ff', fontSize: 15, fontWeight: '600' }, pageTitle: { flex: 1, textAlign: 'center', color: '#14241d', fontWeight: '800', fontSize: 17 }, headerSpacer: { width: 82 },
  homeScroll: { padding: 18, paddingBottom: 36 }, homeHeading: { paddingVertical: 14, marginBottom: 12 }, homeTitle: { fontSize: 28, fontWeight: '800', color: '#14241d' }, homeSubtitle: { color: '#75847b', marginTop: 5, fontSize: 14 },
  entryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, entryCard: { width: '48%', minHeight: 154, borderWidth: 1, borderColor: '#dde7e0', borderRadius: 16, backgroundColor: '#fff', padding: 16 }, entryIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 15 }, entryIconText: { fontSize: 25, color: '#263d33' }, entryTitle: { color: '#14241d', fontWeight: '800', fontSize: 16 }, entrySubtitle: { color: '#75847b', fontSize: 12, marginTop: 6, lineHeight: 17 },
  pageScroll: { padding: 14, paddingBottom: 30 }, listScroll: { paddingHorizontal: 14, paddingBottom: 30 }, toolbar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 }, toolbarText: { color: '#75847b', fontSize: 13 }, toolbarActions: { flexDirection: 'row', gap: 8 }, searchRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 12 }, searchInput: { flex: 1, height: 38, borderRadius: 8, borderWidth: 1, borderColor: '#d3ded7', backgroundColor: '#fff', paddingHorizontal: 12, color: '#14241d' },
  card: { marginBottom: 12, borderColor: '#dce6df' }, bodyText: { color: '#2f4038', fontSize: 14, lineHeight: 20, marginTop: 9 }, mutedText: { color: '#7b8981', fontSize: 12, marginTop: 7 }, feedbackContent: { color: '#2f4038', fontSize: 14, lineHeight: 21, marginBottom: 10 }, tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  stateBox: { paddingVertical: 60, alignItems: 'center' }, emptyText: { color: '#89978f' }, pager: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16, marginVertical: 8 }, pagerText: { color: '#65756c', minWidth: 54, textAlign: 'center' },
  periodRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }, metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }, metricCard: { width: '48%', minHeight: 120, borderRadius: 14, borderWidth: 1, borderColor: '#dbe6df', backgroundColor: '#fff', padding: 14 }, metricLabel: { color: '#65756c', fontSize: 13 }, metricValue: { color: '#14241d', fontSize: 28, fontWeight: '800', marginTop: 8 }, metricNote: { color: '#7b8981', fontSize: 11, marginTop: 5 }, dataRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5ece7' }, dataLabel: { color: '#617169', fontSize: 12 }, dataValue: { color: '#203129', fontSize: 12, fontWeight: '700' },
  modalScroll: { maxHeight: 480 }, field: { marginBottom: 14 }, fieldLabel: { color: '#34473d', fontWeight: '700', fontSize: 13, marginBottom: 7 }, input: { minHeight: 44, borderWidth: 1, borderColor: '#ccd9d1', borderRadius: 9, color: '#14241d', backgroundColor: '#fff', paddingHorizontal: 11, paddingVertical: 9 }, textarea: { minHeight: 116, textAlignVertical: 'top' }, switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50 },
  bindingList: { maxHeight: 420 }, checkRow: { flexDirection: 'row', alignItems: 'center', minHeight: 46, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e1e9e3' }, checkbox: { width: 22, height: 22, borderWidth: 1, borderColor: '#aebcb3', borderRadius: 5, textAlign: 'center', lineHeight: 20, color: '#fff' }, checkboxChecked: { backgroundColor: '#1677ff', borderColor: '#1677ff' }, checkLabel: { flex: 1, marginLeft: 10, color: '#263a30' },
  detailMeta: { color: '#728078', fontSize: 12, marginBottom: 12 }, detailContent: { color: '#24372d', fontSize: 15, lineHeight: 23, padding: 12, backgroundColor: '#f6f9f7', borderRadius: 9, marginBottom: 14 }, fileRow: { paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e3ebe5' }, fileName: { color: '#2c4035', fontWeight: '700' }, registeredUserRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e3ebe5' }, roleChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
});
