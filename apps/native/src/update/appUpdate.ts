import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import appConfig from '../../app.json';

const RELEASE_API_URL = 'https://api.github.com/repos/piperhex/codex-switch/releases/latest';
const UPDATE_METADATA_KEY = 'codex-switch.mobile.android-update.v1';
const APK_MIME_TYPE = 'application/vnd.android.package-archive';

export const RELEASES_URL = 'https://github.com/piperhex/codex-switch/releases';
export const CURRENT_APP_VERSION =
  Application.nativeApplicationVersion ?? appConfig.expo.version;
export const CURRENT_BUILD_VERSION =
  Application.nativeBuildVersion ?? String(appConfig.expo.android.versionCode ?? 1);

export interface AndroidReleaseAsset {
  name: string;
  downloadUrl: string;
  size: number;
}

export interface AppRelease {
  version: string;
  tagName: string;
  title: string;
  notes: string;
  publishedAt: string | null;
  releaseUrl: string;
  androidAsset: AndroidReleaseAsset | null;
}

export interface AppUpdateCheck {
  currentVersion: string;
  updateAvailable: boolean;
  release: AppRelease;
}

export type AndroidUpdateDownloadState =
  | { status: 'idle' }
  | { status: 'downloading'; version: string }
  | { status: 'downloaded'; version: string; path: string }
  | { status: 'failed'; version: string; message: string };

interface StoredAndroidUpdate {
  version: string;
  path: string;
  expectedSize: number;
}

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
  content_type?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

type DownloadListener = (state: AndroidUpdateDownloadState) => void;

let downloadState: AndroidUpdateDownloadState = { status: 'idle' };
let activeDownload: Promise<string> | null = null;
const downloadListeners = new Set<DownloadListener>();

function normalizedVersion(value: string) {
  return value.trim().replace(/^v/i, '').split('+', 1)[0];
}

function parseVersion(value: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(normalizedVersion(value));
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])] as const,
    prerelease: match[4]?.split('.') ?? [],
  };
}

function comparePrerelease(left: string[], right: string[]) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

export function compareAppVersions(left: string, right: string) {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) return normalizedVersion(left).localeCompare(normalizedVersion(right));

  for (let index = 0; index < parsedLeft.core.length; index += 1) {
    if (parsedLeft.core[index] === parsedRight.core[index]) continue;
    return parsedLeft.core[index] > parsedRight.core[index] ? 1 : -1;
  }
  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function androidAssetFrom(value: unknown): AndroidReleaseAsset | null {
  if (!Array.isArray(value)) return null;
  const assets = value as GitHubReleaseAsset[];
  const asset = assets.find((candidate) => {
    const name = textValue(candidate.name);
    const contentType = textValue(candidate.content_type);
    return /\.apk$/i.test(name) && (/android/i.test(name) || contentType === APK_MIME_TYPE);
  });
  if (!asset) return null;
  const name = textValue(asset.name);
  const downloadUrl = textValue(asset.browser_download_url);
  if (!name || !downloadUrl) return null;
  return { name, downloadUrl, size: numberValue(asset.size) };
}

export async function checkForAppUpdate(): Promise<AppUpdateCheck> {
  const response = await fetch(`${RELEASE_API_URL}?t=${Date.now()}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'Cache-Control': 'no-cache',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`检查更新服务返回 HTTP ${response.status}`);
  }

  const payload = await response.json() as GitHubRelease;
  const tagName = textValue(payload.tag_name);
  const version = normalizedVersion(tagName);
  const releaseUrl = textValue(payload.html_url);
  if (!version || !parseVersion(version) || !releaseUrl) {
    throw new Error('最新版本信息格式无效');
  }

  const release: AppRelease = {
    version,
    tagName,
    title: textValue(payload.name) || `Codex Switch ${tagName}`,
    notes: textValue(payload.body),
    publishedAt: textValue(payload.published_at) || null,
    releaseUrl,
    androidAsset: androidAssetFrom(payload.assets),
  };
  return {
    currentVersion: CURRENT_APP_VERSION,
    updateAvailable: compareAppVersions(version, CURRENT_APP_VERSION) > 0,
    release,
  };
}

function publishDownloadState(nextState: AndroidUpdateDownloadState) {
  downloadState = nextState;
  downloadListeners.forEach((listener) => listener(nextState));
}

export function getAndroidUpdateDownloadState() {
  return downloadState;
}

export function subscribeAndroidUpdateDownload(listener: DownloadListener) {
  downloadListeners.add(listener);
  return () => downloadListeners.delete(listener);
}

async function blobUtil() {
  try {
    return (await import('react-native-blob-util')).default;
  } catch {
    throw new Error('当前安装包不包含后台下载组件，请安装最新完整版本后重试');
  }
}

async function readStoredAndroidUpdate(): Promise<StoredAndroidUpdate | null> {
  const stored = await SecureStore.getItemAsync(UPDATE_METADATA_KEY);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as Partial<StoredAndroidUpdate>;
    if (
      typeof value.version !== 'string'
      || typeof value.path !== 'string'
      || typeof value.expectedSize !== 'number'
    ) {
      return null;
    }
    return value as StoredAndroidUpdate;
  } catch {
    return null;
  }
}

async function storedUpdateIsComplete(stored: StoredAndroidUpdate) {
  const util = await blobUtil();
  if (!await util.fs.exists(stored.path)) return false;
  if (stored.expectedSize <= 0) return true;
  const stat = await util.fs.stat(stored.path);
  return Number(stat.size) === stored.expectedSize;
}

export async function refreshAndroidUpdateDownloadState() {
  if (Platform.OS !== 'android' || activeDownload) return downloadState;
  const stored = await readStoredAndroidUpdate();
  if (!stored) {
    publishDownloadState({ status: 'idle' });
    return downloadState;
  }
  if (compareAppVersions(stored.version, CURRENT_APP_VERSION) <= 0) {
    await SecureStore.deleteItemAsync(UPDATE_METADATA_KEY);
    publishDownloadState({ status: 'idle' });
    return downloadState;
  }
  try {
    if (await storedUpdateIsComplete(stored)) {
      publishDownloadState({ status: 'downloaded', version: stored.version, path: stored.path });
    } else {
      publishDownloadState({ status: 'downloading', version: stored.version });
    }
  } catch {
    publishDownloadState({ status: 'downloading', version: stored.version });
  }
  return downloadState;
}

export async function startAndroidUpdateDownload(release: AppRelease) {
  if (Platform.OS !== 'android') throw new Error('应用内安装目前仅支持 Android');
  if (!release.androidAsset) throw new Error('该版本没有可用的 Android 安装包');
  if (activeDownload) return activeDownload;
  const androidAsset = release.androidAsset;

  publishDownloadState({ status: 'downloading', version: release.version });
  activeDownload = (async () => {
    try {
      const util = await blobUtil();
      const safeVersion = release.version.replace(/[^0-9A-Za-z.-]/g, '-');
      const path = `${util.fs.dirs.DownloadDir}/CodexSwitch-update-${safeVersion}-${Date.now()}.apk`;
      const stored: StoredAndroidUpdate = {
        version: release.version,
        path,
        expectedSize: androidAsset.size,
      };
      await SecureStore.setItemAsync(UPDATE_METADATA_KEY, JSON.stringify(stored));
      const response = await util.config({
        addAndroidDownloads: {
          useDownloadManager: true,
          notification: true,
          mediaScannable: true,
          path,
          title: `Codex Switch ${release.version}`,
          description: '下载完成后可安装更新',
          mime: APK_MIME_TYPE,
        },
      }).fetch('GET', androidAsset.downloadUrl);
      const downloadedPath = response.path() || path;
      const completed = { ...stored, path: downloadedPath };
      await SecureStore.setItemAsync(UPDATE_METADATA_KEY, JSON.stringify(completed));
      publishDownloadState({ status: 'downloaded', version: release.version, path: downloadedPath });
      return downloadedPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await SecureStore.deleteItemAsync(UPDATE_METADATA_KEY).catch(() => undefined);
      publishDownloadState({ status: 'failed', version: release.version, message });
      throw error;
    } finally {
      activeDownload = null;
    }
  })();
  return activeDownload;
}

export async function installDownloadedAndroidUpdate(path: string) {
  if (Platform.OS !== 'android') throw new Error('应用内安装目前仅支持 Android');
  const util = await blobUtil();
  await util.android.actionViewIntent(path, APK_MIME_TYPE);
}
