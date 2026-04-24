"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const channels_1 = require("../electron/ipc/channels");
const electronAPI = {
    // 1. 系统基础
    system: {
        getDeviceStatus: () => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.SYSTEM.GET_DEVICE_STATUS),
    },
    auth: {
        login: (options) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.AUTH.LOGIN, options),
        logout: () => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.AUTH.LOGOUT),
        getSession: () => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.AUTH.GET_SESSION),
    },
    license: {
        verify: (key) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.LICENSE.VERIFY, key),
        checkStatus: () => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.LICENSE.CHECK_STATUS),
        getInfo: () => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.LICENSE.GET_INFO),
        submit: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.LICENSE.SUBMIT, payload),
        requestTrial: () => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.LICENSE.REQUEST_TRIAL),
    },
    config: {
        get: (key) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.CONFIG.GET, key),
        set: (data) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.CONFIG.SET, data),
        save: (data) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.CONFIG.SET, data),
        fetchModels: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.CONFIG.FETCH_MODELS, payload),
    },
    autopilot: {
        getState: () => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.AUTOPILOT.GET_STATE),
        setState: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.AUTOPILOT.SET_STATE, payload),
        clearLegacy: () => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.AUTOPILOT.CLEAR_LEGACY),
        syncLifecycle: (lifecycle) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.AUTOPILOT.SYNC_STATE, lifecycle),
    },
    secret: {
        set: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.SECRET.SET, payload),
        check: (key) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.SECRET.CHECK, key),
    },
    api: {
        testConnection: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.SEARCH.API_TEST_CONNECTION, payload),
        proxy: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.SEARCH.API_PROXY, payload),
    },
    search: {
        execute: (query) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.SEARCH.EXECUTE, query),
    },
    onSearchStreamStart: (callback) => {
        const listener = (_event, total) => {
            callback(typeof total === 'number' ? total : 0);
        };
        electron_1.ipcRenderer.on(channels_1.IPC_CHANNELS.SEARCH.STREAM_START, listener);
        return () => electron_1.ipcRenderer.removeListener(channels_1.IPC_CHANNELS.SEARCH.STREAM_START, listener);
    },
    onSearchStage: (callback) => {
        const listener = (_event, payload) => {
            if (payload && typeof payload === 'object') {
                callback(payload);
            }
        };
        electron_1.ipcRenderer.on(channels_1.IPC_CHANNELS.SEARCH.STAGE, listener);
        return () => electron_1.ipcRenderer.removeListener(channels_1.IPC_CHANNELS.SEARCH.STAGE, listener);
    },
    onSearchBasicResults: (callback) => {
        const listener = (_event, results) => {
            callback(Array.isArray(results) ? results : []);
        };
        electron_1.ipcRenderer.on(channels_1.IPC_CHANNELS.SEARCH.BASIC_RESULTS, listener);
        return () => electron_1.ipcRenderer.removeListener(channels_1.IPC_CHANNELS.SEARCH.BASIC_RESULTS, listener);
    },
    onSearchLeadScored: (callback) => {
        const listener = (_event, payload) => {
            if (payload && typeof payload === 'object') {
                callback(payload);
            }
        };
        electron_1.ipcRenderer.on(channels_1.IPC_CHANNELS.SEARCH.LEAD_SCORED, listener);
        return () => electron_1.ipcRenderer.removeListener(channels_1.IPC_CHANNELS.SEARCH.LEAD_SCORED, listener);
    },
    onSearchStreamComplete: (callback) => {
        const listener = () => callback();
        electron_1.ipcRenderer.on(channels_1.IPC_CHANNELS.SEARCH.STREAM_COMPLETE, listener);
        return () => electron_1.ipcRenderer.removeListener(channels_1.IPC_CHANNELS.SEARCH.STREAM_COMPLETE, listener);
    },
    onSearchStreamError: (callback) => {
        const listener = (_event, error) => {
            callback(typeof error === 'string' ? error : 'Search stream failed');
        };
        electron_1.ipcRenderer.on(channels_1.IPC_CHANNELS.SEARCH.STREAM_ERROR, listener);
        return () => electron_1.ipcRenderer.removeListener(channels_1.IPC_CHANNELS.SEARCH.STREAM_ERROR, listener);
    },
    onAutopilotAction: (callback) => {
        const listener = (_event, action) => {
            if (action === 'pause' || action === 'resume' || action === 'stop') {
                callback(action);
            }
        };
        electron_1.ipcRenderer.on(channels_1.IPC_CHANNELS.SYSTEM.AUTOPILOT_ACTION, listener);
        return () => electron_1.ipcRenderer.removeListener(channels_1.IPC_CHANNELS.SYSTEM.AUTOPILOT_ACTION, listener);
    },
    analysis: {
        generate: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.SEARCH.ANALYSIS_GENERATE, payload),
    },
    files: {
        saveExport: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.FILES.EXPORT_SAVE, payload),
    },
    cloud: {
        checkCollision: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.CLOUD.CHECK_COLLISION, payload),
        syncLead: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.CLOUD.SYNC_LEAD, payload),
        upsertLead: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.CLOUD.UPSERT_LEAD, payload),
        checkDomains: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.CLOUD.CHECK_DOMAINS, payload),
        createCampaign: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.CLOUD.CREATE_CAMPAIGN, payload),
        fetchTeamLeads: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.CLOUD.FETCH_TEAM_LEADS, payload),
        fetchTracking: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.CLOUD.FETCH_TRACKING, payload),
        subscribeRealtime: () => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.CLOUD.SUBSCRIBE_REALTIME),
        unsubscribeRealtime: () => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.CLOUD.UNSUBSCRIBE_REALTIME),
        fetchClaimedDomains: () => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.CLOUD.FETCH_CLAIMED_DOMAINS),
    },
    onCloudRealtimeLeadEvent: (callback) => {
        const listener = (_event, payload) => {
            if (payload && typeof payload === 'object')
                callback(payload);
        };
        electron_1.ipcRenderer.on(channels_1.IPC_CHANNELS.CLOUD.REALTIME_LEAD_EVENT, listener);
        return () => electron_1.ipcRenderer.removeListener(channels_1.IPC_CHANNELS.CLOUD.REALTIME_LEAD_EVENT, listener);
    },
    automation: {
        verifyEmails: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.AUTOMATION.VERIFY_EMAILS, payload),
        startCampaign: (payload) => electron_1.ipcRenderer.invoke(channels_1.IPC_CHANNELS.AUTOMATION.START_CAMPAIGN, payload),
    },
};
electron_1.contextBridge.exposeInMainWorld('electronAPI', electronAPI);
