--
-- PostgreSQL database dump
--


-- Dumped from database version 16.11 (Debian 16.11-1.pgdg13+1)
-- Dumped by pg_dump version 16.11 (Debian 16.11-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_approval_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_approval_requests (
    id uuid NOT NULL,
    type character varying(60) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    "requestedById" uuid NOT NULL,
    "requestedByEmail" character varying(160) NOT NULL,
    "reviewedById" uuid,
    "reviewedByEmail" character varying(160),
    "targetUserId" uuid NOT NULL,
    "targetEmail" character varying(160) NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    comment text DEFAULT ''::text NOT NULL,
    "reviewComment" text DEFAULT ''::text NOT NULL,
    "reviewedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_logs (
    id uuid NOT NULL,
    "actorId" uuid,
    "actorEmail" character varying(160) DEFAULT ''::character varying NOT NULL,
    action character varying(80) NOT NULL,
    "targetType" character varying(40) NOT NULL,
    "targetId" character varying(160),
    "targetEmail" character varying(160),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_invitations (
    id uuid NOT NULL,
    email character varying(160),
    role character varying(64) DEFAULT 'user'::character varying NOT NULL,
    "tokenHash" character varying(128) NOT NULL,
    "createdById" uuid NOT NULL,
    "createdByEmail" character varying(160) NOT NULL,
    "acceptedById" uuid,
    "maxUses" integer DEFAULT 1 NOT NULL,
    "usedCount" integer DEFAULT 0 NOT NULL,
    "expiresAt" timestamp with time zone,
    "acceptedAt" timestamp with time zone,
    "revokedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: announcement_link_clicks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcement_link_clicks (
    id uuid NOT NULL,
    "deviceId" uuid NOT NULL,
    platform character varying(20) NOT NULL,
    email character varying(160),
    link character varying(2048) NOT NULL,
    "announcementUpdatedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_announcements (
    id character varying(32) NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    "contentEn" text DEFAULT ''::text NOT NULL,
    link character varying(2048) DEFAULT ''::character varying NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    "textColor" character varying(7) DEFAULT '#C4D7C8'::character varying NOT NULL,
    "backgroundColor" character varying(7) DEFAULT '#203128'::character varying NOT NULL,
    "darkTextColor" character varying(7) DEFAULT '#C4D7C8'::character varying NOT NULL,
    "darkBackgroundColor" character varying(7) DEFAULT '#203128'::character varying NOT NULL,
    "scrollDurationSeconds" integer DEFAULT 22 NOT NULL,
    "updatedById" uuid,
    "updatedByEmail" character varying(160) DEFAULT ''::character varying NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_faqs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_faqs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "questionZh" character varying(300) NOT NULL,
    "questionEn" character varying(300) NOT NULL,
    "answerZh" text NOT NULL,
    "answerEn" text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "updatedById" uuid,
    "updatedByEmail" character varying(160) DEFAULT ''::character varying NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "titleZh" character varying(160) NOT NULL,
    "titleEn" character varying(160) NOT NULL,
    "contentZh" text NOT NULL,
    "contentEn" text NOT NULL,
    link character varying(2048) DEFAULT ''::character varying NOT NULL,
    "linkLabelZh" character varying(80) DEFAULT ''::character varying NOT NULL,
    "linkLabelEn" character varying(80) DEFAULT ''::character varying NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    "publishedAt" timestamp with time zone NOT NULL,
    "updatedById" uuid,
    "updatedByEmail" character varying(160) DEFAULT ''::character varying NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_relay_traffic; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_relay_traffic (
    hour_start timestamp with time zone NOT NULL,
    reporter_id uuid NOT NULL,
    bytes bigint DEFAULT '0'::bigint NOT NULL
);


--
-- Name: chat_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_settings (
    id character varying(32) NOT NULL,
    policy jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: codex_home_preset_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.codex_home_preset_settings (
    id character varying(32) NOT NULL,
    presets jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_by_id uuid,
    updated_by_email character varying(160) DEFAULT ''::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: currency_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currency_settings (
    id character varying(32) NOT NULL,
    encrypted_api_key text,
    currencies jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_by_id uuid,
    updated_by_email character varying(160) DEFAULT ''::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: device_installations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_installations (
    "deviceId" uuid NOT NULL,
    platform character varying(20) NOT NULL,
    "appVersion" character varying(50),
    "firstSeenAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: device_telemetry_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_telemetry_events (
    id uuid NOT NULL,
    "deviceId" uuid NOT NULL,
    platform character varying(20) NOT NULL,
    "eventType" character varying(40) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_templates (
    code character varying(100) NOT NULL,
    subject character varying(300) NOT NULL,
    body text NOT NULL,
    "mailServiceId" uuid,
    "updatedById" uuid,
    "updatedByEmail" character varying(160) DEFAULT ''::character varying NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mail_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_services (
    id uuid NOT NULL,
    name character varying(100) NOT NULL,
    host character varying(255) NOT NULL,
    port integer NOT NULL,
    secure boolean DEFAULT true NOT NULL,
    username character varying(255) NOT NULL,
    "encryptedPassword" text NOT NULL,
    "fromAddress" character varying(320) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    "createdById" uuid,
    "createdByEmail" character varying(160) DEFAULT ''::character varying NOT NULL,
    "updatedById" uuid,
    "updatedByEmail" character varying(160) DEFAULT ''::character varying NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prompt_plugin_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prompt_plugin_items (
    id uuid NOT NULL,
    name character varying(120) NOT NULL,
    version character varying(40) NOT NULL,
    type character varying(16) NOT NULL,
    text text NOT NULL,
    "uploaderId" uuid,
    "uploaderEmail" character varying(160) NOT NULL,
    "installCount" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rbac_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_permissions (
    code character varying(100) NOT NULL,
    "group" character varying(60) NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(500) DEFAULT ''::character varying NOT NULL,
    system boolean DEFAULT false NOT NULL
);


--
-- Name: rbac_role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_role_permissions (
    "roleCode" character varying(64) NOT NULL,
    "permissionCode" character varying(100) NOT NULL
);


--
-- Name: rbac_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_roles (
    code character varying(64) NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(500) DEFAULT ''::character varying NOT NULL,
    system boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid NOT NULL,
    "userId" uuid NOT NULL,
    "tokenHash" character varying(128) NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "revokedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: remote_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remote_devices (
    "ownerId" uuid NOT NULL,
    "deviceId" uuid NOT NULL,
    name character varying(120) NOT NULL,
    platform character varying(20) NOT NULL,
    "appVersion" character varying(50),
    "activeAccountId" character varying(64),
    "openaiAuthAccountId" character varying(64),
    "activeProviderId" character varying(64),
    "activeProviderGroup" character varying(80),
    "localProxyRunning" boolean DEFAULT false NOT NULL,
    capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
    "lastSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: skill_market_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_market_items (
    id uuid NOT NULL,
    title character varying(120) NOT NULL,
    description text NOT NULL,
    version character varying(40) NOT NULL,
    "archiveFileName" character varying(255) NOT NULL,
    "archiveMimeType" character varying(80) NOT NULL,
    "archiveSize" integer NOT NULL,
    "archiveSha256" character(64) NOT NULL,
    "archiveData" bytea NOT NULL,
    "previewMimeType" character varying(80),
    "previewSize" integer,
    "previewData" bytea,
    "uploaderId" uuid,
    "uploaderEmail" character varying(160) NOT NULL,
    official boolean DEFAULT false NOT NULL,
    "installCount" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: synced_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.synced_accounts (
    id uuid NOT NULL,
    "ownerId" uuid NOT NULL,
    "accountId" character varying(64) NOT NULL,
    email character varying(240) NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    "expiresAt" character varying(40) DEFAULT ''::character varying NOT NULL,
    "privateDetails" jsonb DEFAULT '{}'::jsonb NOT NULL,
    plan character varying(80) DEFAULT 'ChatGPT'::character varying NOT NULL,
    "codexAccountId" character varying(160),
    active boolean DEFAULT false NOT NULL,
    "autoSwitchPriority" integer DEFAULT 0 NOT NULL,
    "autoSwitchThreshold" double precision DEFAULT '0'::double precision NOT NULL,
    usage jsonb DEFAULT '{}'::jsonb NOT NULL,
    "lastModifiedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "fieldModifiedAt" jsonb DEFAULT '{}'::jsonb NOT NULL,
    auth jsonb NOT NULL,
    "deletedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: synced_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.synced_providers (
    id uuid NOT NULL,
    "ownerId" uuid NOT NULL,
    "providerId" character varying(64) NOT NULL,
    kind character varying(24) DEFAULT 'custom'::character varying NOT NULL,
    name character varying(160) NOT NULL,
    "group" character varying(80) DEFAULT ''::character varying NOT NULL,
    "baseUrl" character varying(500) NOT NULL,
    "apiKey" text NOT NULL,
    model character varying(160) NOT NULL,
    models jsonb DEFAULT '[]'::jsonb NOT NULL,
    "modelReasoningEfforts" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "modelContextWindows" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "modelApiFormats" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "imageInputModels" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "contextWindow" integer,
    "modelSelectionControlledByCodex" boolean DEFAULT false NOT NULL,
    "fastModeEnabled" boolean DEFAULT false NOT NULL,
    "apiFormat" character varying(24) NOT NULL,
    "balancePlatform" character varying(24),
    "balanceQueryUrl" character varying(1000),
    "balanceQueryToken" text,
    "walletQueryUrl" character varying(1000),
    "walletQueryToken" text,
    "walletUsername" character varying(320),
    "walletPassword" text,
    "lastModifiedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "fieldModifiedAt" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "deletedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: synced_totp_vaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.synced_totp_vaults (
    id uuid NOT NULL,
    "ownerId" uuid NOT NULL,
    entries jsonb DEFAULT '[]'::jsonb NOT NULL,
    tombstones jsonb DEFAULT '[]'::jsonb NOT NULL,
    "modifiedAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_account_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_account_bindings (
    "systemAccountId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_accounts (
    id uuid NOT NULL,
    "syncAccountId" character varying(64) NOT NULL,
    email character varying(240) NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    "expiresAt" character varying(40) DEFAULT ''::character varying NOT NULL,
    plan character varying(80) DEFAULT 'ChatGPT'::character varying NOT NULL,
    "codexAccountId" character varying(160),
    usage jsonb DEFAULT '{}'::jsonb NOT NULL,
    auth jsonb NOT NULL,
    source character varying(20) DEFAULT 'admin'::character varying NOT NULL,
    "addedByUserId" uuid,
    "addedByEmail" character varying(240),
    "sourceAccountId" character varying(64),
    "lastModifiedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_feedback (
    id uuid NOT NULL,
    content text NOT NULL,
    version character varying(40) NOT NULL,
    platform character varying(500) NOT NULL,
    "userId" uuid,
    email character varying(160),
    "lastRepliedAt" timestamp with time zone,
    "lastRepliedById" uuid,
    "lastRepliedByEmail" character varying(160),
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_feedback_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_feedback_attachments (
    id uuid NOT NULL,
    "feedbackId" uuid NOT NULL,
    "fileName" character varying(255) NOT NULL,
    "mimeType" character varying(80) NOT NULL,
    size integer NOT NULL,
    data bytea NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email character varying(160) NOT NULL,
    "passwordHash" character varying(120) NOT NULL,
    role character varying(64) DEFAULT 'user'::character varying NOT NULL,
    disabled boolean DEFAULT false NOT NULL,
    "lastLoginAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_account_bindings PK_0852b4c4249661a0432977cc881; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_account_bindings
    ADD CONSTRAINT "PK_0852b4c4249661a0432977cc881" PRIMARY KEY ("systemAccountId", "userId");


--
-- Name: admin_invitations PK_0c710b9106ea89847bcf62bd3e1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_invitations
    ADD CONSTRAINT "PK_0c710b9106ea89847bcf62bd3e1" PRIMARY KEY (id);


--
-- Name: currency_settings PK_0f030551e0990c29b4db6f0f62b; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency_settings
    ADD CONSTRAINT "PK_0f030551e0990c29b4db6f0f62b" PRIMARY KEY (id);


--
-- Name: chat_settings PK_1802e10ebbe48cf6de0047de64d; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_settings
    ADD CONSTRAINT "PK_1802e10ebbe48cf6de0047de64d" PRIMARY KEY (id);


--
-- Name: mail_services PK_1ef95f3fe9df7f9707e5ed8e16e; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_services
    ADD CONSTRAINT "PK_1ef95f3fe9df7f9707e5ed8e16e" PRIMARY KEY (id);


--
-- Name: rbac_role_permissions PK_24704faf04e2900edae090d3389; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_role_permissions
    ADD CONSTRAINT "PK_24704faf04e2900edae090d3389" PRIMARY KEY ("roleCode", "permissionCode");


--
-- Name: device_installations PK_34e54486d74f46cc3221048ad54; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_installations
    ADD CONSTRAINT "PK_34e54486d74f46cc3221048ad54" PRIMARY KEY ("deviceId");


--
-- Name: app_announcements PK_4e7ecaa3a2fce5f1b9535e99fac; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_announcements
    ADD CONSTRAINT "PK_4e7ecaa3a2fce5f1b9535e99fac" PRIMARY KEY (id);


--
-- Name: app_notifications PK_4ff08fe3c2ebf2593490403bbe0; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_notifications
    ADD CONSTRAINT "PK_4ff08fe3c2ebf2593490403bbe0" PRIMARY KEY (id);


--
-- Name: synced_providers PK_536f17fed1ed84bdec9c48f47f1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synced_providers
    ADD CONSTRAINT "PK_536f17fed1ed84bdec9c48f47f1" PRIMARY KEY (id);


--
-- Name: rbac_roles PK_5d9f68571675c5ff88ef7453cc2; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_roles
    ADD CONSTRAINT "PK_5d9f68571675c5ff88ef7453cc2" PRIMARY KEY (code);


--
-- Name: announcement_link_clicks PK_6b0cdaedb39aa1551dfa24cf37a; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_link_clicks
    ADD CONSTRAINT "PK_6b0cdaedb39aa1551dfa24cf37a" PRIMARY KEY (id);


--
-- Name: codex_home_preset_settings PK_7bc16523eec8c4be0c3aa5ec731; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.codex_home_preset_settings
    ADD CONSTRAINT "PK_7bc16523eec8c4be0c3aa5ec731" PRIMARY KEY (id);


--
-- Name: chat_relay_traffic PK_7bf5ded5b4bcbdb7e499d59ce85; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_relay_traffic
    ADD CONSTRAINT "PK_7bf5ded5b4bcbdb7e499d59ce85" PRIMARY KEY (hour_start, reporter_id);


--
-- Name: refresh_tokens PK_7d8bee0204106019488c4c50ffa; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY (id);


--
-- Name: prompt_plugin_items PK_8b31e502ee5a172861398b05df8; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_plugin_items
    ADD CONSTRAINT "PK_8b31e502ee5a172861398b05df8" PRIMARY KEY (id);


--
-- Name: synced_totp_vaults PK_906fedc9e20d8aebf7170c126d9; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synced_totp_vaults
    ADD CONSTRAINT "PK_906fedc9e20d8aebf7170c126d9" PRIMARY KEY (id);


--
-- Name: user_feedback PK_94fb2b9415a96bde222d5e40598; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feedback
    ADD CONSTRAINT "PK_94fb2b9415a96bde222d5e40598" PRIMARY KEY (id);


--
-- Name: skill_market_items PK_9b4fe09c56633b798f9576d9c97; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_market_items
    ADD CONSTRAINT "PK_9b4fe09c56633b798f9576d9c97" PRIMARY KEY (id);


--
-- Name: users PK_a3ffb1c0c8416b9fc6f907b7433; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY (id);


--
-- Name: app_faqs PK_a6b0ff42aafd0466ac1efc77d3d; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_faqs
    ADD CONSTRAINT "PK_a6b0ff42aafd0466ac1efc77d3d" PRIMARY KEY (id);


--
-- Name: system_accounts PK_a7eb3b7f39c5b2aca5e00682390; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_accounts
    ADD CONSTRAINT "PK_a7eb3b7f39c5b2aca5e00682390" PRIMARY KEY (id);


--
-- Name: user_feedback_attachments PK_b1c2d72909dc4be8278920c664c; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feedback_attachments
    ADD CONSTRAINT "PK_b1c2d72909dc4be8278920c664c" PRIMARY KEY (id);


--
-- Name: remote_devices PK_b9550635a02acca0d9c978d7b0a; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_devices
    ADD CONSTRAINT "PK_b9550635a02acca0d9c978d7b0a" PRIMARY KEY ("ownerId", "deviceId");


--
-- Name: device_telemetry_events PK_c35d7ce7b49e343fb924d4a47a5; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_telemetry_events
    ADD CONSTRAINT "PK_c35d7ce7b49e343fb924d4a47a5" PRIMARY KEY (id);


--
-- Name: admin_approval_requests PK_c457eba00b8ac908d0fd2fb37d3; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_approval_requests
    ADD CONSTRAINT "PK_c457eba00b8ac908d0fd2fb37d3" PRIMARY KEY (id);


--
-- Name: rbac_permissions PK_d7cd68228b71c7eeaac9f4dbcfb; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_permissions
    ADD CONSTRAINT "PK_d7cd68228b71c7eeaac9f4dbcfb" PRIMARY KEY (code);


--
-- Name: synced_accounts PK_dac327d1ed2ed212a1e3e4be33d; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synced_accounts
    ADD CONSTRAINT "PK_dac327d1ed2ed212a1e3e4be33d" PRIMARY KEY (id);


--
-- Name: admin_audit_logs PK_de7a8fc2fbb525484c71a86bb96; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT "PK_de7a8fc2fbb525484c71a86bb96" PRIMARY KEY (id);


--
-- Name: email_templates PK_e65f590d27b63f71b3d3e01dd33; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT "PK_e65f590d27b63f71b3d3e01dd33" PRIMARY KEY (code);


--
-- Name: mail_services UQ_926e223f759df82c7bb2e463e1a; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_services
    ADD CONSTRAINT "UQ_926e223f759df82c7bb2e463e1a" UNIQUE (name);


--
-- Name: users UQ_97672ac88f789774dd47f7c8be3; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE (email);


--
-- Name: IDX_08125700cf6610f8ba3d6f511e; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_08125700cf6610f8ba3d6f511e" ON public.device_telemetry_events USING btree ("deviceId", "createdAt");


--
-- Name: IDX_163d1ffb844dcfe403246492e7; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_163d1ffb844dcfe403246492e7" ON public.admin_approval_requests USING btree ("targetUserId");


--
-- Name: IDX_1e558f704cd36987cf1618fea6; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "IDX_1e558f704cd36987cf1618fea6" ON public.synced_accounts USING btree ("ownerId", "accountId");


--
-- Name: IDX_224d7718de707d166fbbf092e4; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_224d7718de707d166fbbf092e4" ON public.skill_market_items USING btree ("createdAt");


--
-- Name: IDX_300e055299c2ffd80aa3a0b732; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_300e055299c2ffd80aa3a0b732" ON public.remote_devices USING btree ("ownerId", name);


--
-- Name: IDX_3648cb96bcc04ac5cbb7ca84c2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_3648cb96bcc04ac5cbb7ca84c2" ON public.admin_invitations USING btree (email);


--
-- Name: IDX_3d04e66be4879357cb57a40c6c; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_3d04e66be4879357cb57a40c6c" ON public.announcement_link_clicks USING btree ("deviceId", "createdAt");


--
-- Name: IDX_40d925861fb6eb6eaaf8c8dd95; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "IDX_40d925861fb6eb6eaaf8c8dd95" ON public.synced_totp_vaults USING btree ("ownerId");


--
-- Name: IDX_506242a2da2d62477a50caab38; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "IDX_506242a2da2d62477a50caab38" ON public.prompt_plugin_items USING btree ("uploaderId", name);


--
-- Name: IDX_51f63a5b02e9c59bf8641564c5; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_51f63a5b02e9c59bf8641564c5" ON public.admin_audit_logs USING btree ("createdAt");


--
-- Name: IDX_5b89a190cbf3f0539f7911a1f9; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_5b89a190cbf3f0539f7911a1f9" ON public.system_account_bindings USING btree ("userId");


--
-- Name: IDX_5d49c245604bbfa780a30ae97d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_5d49c245604bbfa780a30ae97d" ON public.admin_audit_logs USING btree (action);


--
-- Name: IDX_656472903e59a2069e0677c0aa; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "IDX_656472903e59a2069e0677c0aa" ON public.admin_invitations USING btree ("tokenHash");


--
-- Name: IDX_7173a14ae8be0037fd46e425d1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_7173a14ae8be0037fd46e425d1" ON public.refresh_tokens USING btree ("userId", "tokenHash");


--
-- Name: IDX_78bd7eab236fceb2c0bf0412c1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "IDX_78bd7eab236fceb2c0bf0412c1" ON public.system_accounts USING btree ("syncAccountId");


--
-- Name: IDX_8a14d7c04eab5c1fcf77426764; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_8a14d7c04eab5c1fcf77426764" ON public.user_feedback_attachments USING btree ("feedbackId");


--
-- Name: IDX_94b894845c4578af253906d29f; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "IDX_94b894845c4578af253906d29f" ON public.synced_providers USING btree ("ownerId", "providerId");


--
-- Name: IDX_9a39ba298aedde670108059010; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_9a39ba298aedde670108059010" ON public.rbac_role_permissions USING btree ("permissionCode");


--
-- Name: IDX_9d20ce3d2000adf61ba1fe562e; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_9d20ce3d2000adf61ba1fe562e" ON public.announcement_link_clicks USING btree (platform, "createdAt");


--
-- Name: IDX_d4cbd814587af26e36e2935e2c; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_d4cbd814587af26e36e2935e2c" ON public.announcement_link_clicks USING btree ("createdAt");


--
-- Name: IDX_d646772defd3b9824a4d4b7416; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_d646772defd3b9824a4d4b7416" ON public.device_telemetry_events USING btree ("eventType", "createdAt");


--
-- Name: IDX_e2d658be6a51158a2755dea6fc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_e2d658be6a51158a2755dea6fc" ON public.rbac_role_permissions USING btree ("roleCode");


--
-- Name: IDX_f05a5fdd58447405fc78c77561; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_f05a5fdd58447405fc78c77561" ON public.admin_approval_requests USING btree (status, "createdAt");


--
-- Name: IDX_f41989b226fff52a6dc407a1e7; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_f41989b226fff52a6dc407a1e7" ON public.prompt_plugin_items USING btree ("createdAt");


--
-- Name: IDX_f8a62750e706d7e25d98d14bba; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_f8a62750e706d7e25d98d14bba" ON public.user_feedback USING btree ("createdAt");


--
-- Name: synced_totp_vaults FK_40d925861fb6eb6eaaf8c8dd95c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synced_totp_vaults
    ADD CONSTRAINT "FK_40d925861fb6eb6eaaf8c8dd95c" FOREIGN KEY ("ownerId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: system_account_bindings FK_5b89a190cbf3f0539f7911a1f9c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_account_bindings
    ADD CONSTRAINT "FK_5b89a190cbf3f0539f7911a1f9c" FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens FK_610102b60fea1455310ccd299de; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT "FK_610102b60fea1455310ccd299de" FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: synced_providers FK_7b986c9e4d2198f01014a0c344e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synced_providers
    ADD CONSTRAINT "FK_7b986c9e4d2198f01014a0c344e" FOREIGN KEY ("ownerId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: email_templates FK_83a87641b85ac31b8384fdc788c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT "FK_83a87641b85ac31b8384fdc788c" FOREIGN KEY ("mailServiceId") REFERENCES public.mail_services(id) ON DELETE SET NULL;


--
-- Name: synced_accounts FK_87a228d37ec7b3c5ada05c9abeb; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synced_accounts
    ADD CONSTRAINT "FK_87a228d37ec7b3c5ada05c9abeb" FOREIGN KEY ("ownerId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_feedback_attachments FK_8a14d7c04eab5c1fcf774267649; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feedback_attachments
    ADD CONSTRAINT "FK_8a14d7c04eab5c1fcf774267649" FOREIGN KEY ("feedbackId") REFERENCES public.user_feedback(id) ON DELETE CASCADE;


--
-- Name: rbac_role_permissions FK_9a39ba298aedde6701080590100; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_role_permissions
    ADD CONSTRAINT "FK_9a39ba298aedde6701080590100" FOREIGN KEY ("permissionCode") REFERENCES public.rbac_permissions(code) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: system_account_bindings FK_b214ada3bc63748d9642dcb600e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_account_bindings
    ADD CONSTRAINT "FK_b214ada3bc63748d9642dcb600e" FOREIGN KEY ("systemAccountId") REFERENCES public.system_accounts(id) ON DELETE CASCADE;


--
-- Name: remote_devices FK_b3b5568f482805b602e7583559d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_devices
    ADD CONSTRAINT "FK_b3b5568f482805b602e7583559d" FOREIGN KEY ("ownerId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: rbac_role_permissions FK_e2d658be6a51158a2755dea6fc8; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_role_permissions
    ADD CONSTRAINT "FK_e2d658be6a51158a2755dea6fc8" FOREIGN KEY ("roleCode") REFERENCES public.rbac_roles(code) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--
