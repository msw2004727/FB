import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

const DB_NAME = 'WenJiang_Game';
let activeDb;

function deleteDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('test database deletion was blocked'));
    });
}

function createLegacyDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const store = request.result.createObjectStore('inventory', { keyPath: 'id' });
            store.put({ id: 'legacy-item', name: '保留資料' });
        };
        request.onsuccess = () => {
            request.result.close();
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

async function loadClientDB() {
    vi.resetModules();
    const module = await import('../../../client/db/clientDB.js');
    const db = await module.init();
    activeDb = db;
    return { ...module, db };
}

beforeEach(async () => {
    vi.resetModules();
    activeDb = null;
    globalThis.indexedDB = indexedDB;
    globalThis.IDBKeyRange = IDBKeyRange;
    if (!globalThis.crypto?.randomUUID) {
        globalThis.crypto = { randomUUID: () => `test-${Date.now()}` };
    }
    await deleteDatabase();
});

afterEach(async () => {
    activeDb?.close();
    activeDb = null;
    await deleteDatabase();
});

describe('clientDB migrations and atomic writes', () => {
    it('keeps the existing v2 contract and upgrades v1 without deleting legacy data', async () => {
        await createLegacyDatabase();
        const { db } = await loadClientDB();

        // There is no schema delta beyond v2. Bumping this would let an open
        // v0.26 tab block the new client indefinitely during rollout.
        expect(db.version).toBe(2);
        expect([...db.objectStoreNames]).toContain('inventory');
        const legacyItem = await new Promise((resolve, reject) => {
            const request = db.transaction('inventory').objectStore('inventory').get('legacy-item');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        expect(legacyItem).toEqual({ id: 'legacy-item', name: '保留資料' });
        db.close();
    });

    it('commits profile, save, chapter and state together and rejects stale rounds', async () => {
        const client = await loadClientDB();
        await client.profiles.create({ id: 'p1', username: '測試者' });

        await client.commitRound(
            'p1',
            { R: 1, story: '第一章', moralityChange: 3 },
            {
                profileUpdates: { morality: 3 },
                stateUpdates: { milestones: ['啟程'] },
                expectedPreviousRound: 0,
            }
        );

        expect(await client.saves.getLatest('p1')).toMatchObject({ R: 1, story: '第一章' });
        expect(await client.novel.getAll('p1')).toMatchObject([{ round: 1, story: '第一章' }]);
        expect(await client.state.get('p1', 'milestones')).toEqual(['啟程']);
        expect(await client.profiles.get('p1')).toMatchObject({ morality: 3, lastCommittedRound: 1 });

        await expect(
            client.commitRound('p1', { R: 1, story: '重複回合' }, { expectedPreviousRound: 0 })
        ).rejects.toMatchObject({ code: 'ROUND_CONFLICT' });
        expect(await client.saves.getAll('p1')).toHaveLength(1);
        client.db.close();
    });

    it('reads the greatest round for only the requested profile', async () => {
        const client = await loadClientDB();
        await client.profiles.create({ id: 'p1', username: '甲玩家' });
        await client.profiles.create({ id: 'p2', username: '乙玩家' });
        await client.saves.add('p1', { R: 1, story: '甲第一回' });
        await client.saves.add('p1', { R: 3, story: '甲第三回' });
        await client.saves.add('p2', { R: 99, story: '乙第九十九回' });

        await expect(client.getProfileAndLatestSave('p1')).resolves.toMatchObject({
            profile: { id: 'p1', username: '甲玩家' },
            lastSave: { profileId: 'p1', R: 3, story: '甲第三回' },
        });
        await expect(client.saves.getLatest('p1')).resolves.toMatchObject({
            profileId: 'p1', R: 3,
        });
        client.db.close();
    });

    it('preserves both a concurrent profile update and an atomic death-round commit', async () => {
        const client = await loadClientDB();
        await client.profiles.create({
            id: 'p1',
            username: '原玩家',
            morality: 0,
            isDeceased: false,
        });

        // Start the profile update first so its transaction is queued alongside
        // commitRound. A split read/write implementation would read the old
        // profile, let commitRound finish, then overwrite the committed fields.
        const rename = client.profiles.update('p1', { username: '新名字' });
        const deathCommit = client.commitRound(
            'p1',
            { R: 1, story: '死亡回合', playerState: 'dead' },
            {
                profileUpdates: { morality: 9, isDeceased: true },
                expectedPreviousRound: 0,
            }
        );

        await Promise.all([rename, deathCommit]);

        expect(await client.profiles.get('p1')).toMatchObject({
            username: '新名字',
            morality: 9,
            isDeceased: true,
            lastCommittedRound: 1,
        });
        expect(await client.saves.getLatest('p1')).toMatchObject({
            R: 1,
            story: '死亡回合',
            playerState: 'dead',
        });
        client.db.close();
    });

    it('never combines an alive profile with a concurrently committed dead save', async () => {
        const client = await loadClientDB();
        const engine = await import('../../../client/engine/gameEngine.js');
        await client.profiles.create({
            id: 'p1', username: '跨分頁玩家', isDeceased: false,
        });
        await client.saves.add('p1', {
            R: 0, story: '仍在旅途中', playerState: 'alive', NPC: [],
        });
        engine.setActiveProfile('p1');

        const loading = engine.getLatestGame();
        const deathCommit = client.commitRound(
            'p1',
            { R: 1, story: '死亡回合', playerState: 'dead', NPC: [] },
            {
                profileUpdates: { isDeceased: true },
                expectedPreviousRound: 0,
            }
        );

        const [loaded] = await Promise.all([loading, deathCommit]);
        const observedState = [loaded.gameState, loaded.roundData?.R, loaded.roundData?.playerState];
        expect([
            ['alive', 0, 'alive'],
            ['deceased', 1, 'dead'],
        ]).toContainEqual(observedState);

        const finalSnapshot = await client.getProfileAndLatestSave('p1');
        expect(finalSnapshot.profile).toMatchObject({ isDeceased: true, lastCommittedRound: 1 });
        expect(finalSnapshot.lastSave).toMatchObject({ R: 1, playerState: 'dead' });
        client.db.close();
    });

    it('treats a dead latest save as authoritative when a legacy profile flag is stale', async () => {
        const client = await loadClientDB();
        const engine = await import('../../../client/engine/gameEngine.js');
        await client.profiles.create({
            id: 'p1', username: '舊存檔玩家', isDeceased: false,
        });
        await client.saves.add('p1', {
            R: 2, story: '舊版死亡回合', playerState: 'dead', NPC: [],
        });
        engine.setActiveProfile('p1');

        await expect(engine.getLatestGame()).resolves.toMatchObject({
            gameState: 'deceased',
            roundData: { R: 2, playerState: 'dead' },
        });
        client.db.close();
    });

    it('rolls back an entire round when a state update is invalid', async () => {
        const client = await loadClientDB();
        await client.profiles.create({ id: 'p1', username: '測試者' });
        await client.commitRound('p1', { R: 1, story: '第一章' });

        await expect(
            client.commitRound(
                'p1',
                { R: 2, story: '不應留下' },
                { stateUpdates: { ['x'.repeat(65)]: true } }
            )
        ).rejects.toThrow();

        expect((await client.saves.getLatest('p1')).R).toBe(1);
        expect(await client.novel.getAll('p1')).toHaveLength(1);
        expect((await client.profiles.get('p1')).lastCommittedRound).toBe(1);
        client.db.close();
    });

    it('keeps existing data when an import fails validation mid-transaction', async () => {
        const client = await loadClientDB();
        await client.profiles.create({ id: 'p1', username: '原玩家' });
        await client.commitRound('p1', { R: 1, story: '原始章節' });

        await expect(
            client.importAll({
                exportVersion: 2,
                profile: { id: 'p1', username: '不應覆蓋' },
                gameSaves: [{ R: 2, story: '不應寫入' }],
                locationStates: [],
                locationTemplates: [{ name: '缺少必要 locationName' }],
                novelChapters: [],
                gameState: {},
            })
        ).rejects.toThrow();

        expect((await client.profiles.get('p1')).username).toBe('原玩家');
        expect(await client.saves.getAll('p1')).toMatchObject([{ R: 1, story: '原始章節' }]);
        expect(await client.novel.getAll('p1')).toMatchObject([{ round: 1, story: '原始章節' }]);
        client.db.close();
    });

    it('atomically resets profile data and creates the new R0 save', async () => {
        const client = await loadClientDB();
        await client.profiles.create({ id: 'p1', username: '原玩家', scenario: 'wuxia' });
        await client.commitRound('p1', { R: 1, story: '舊章節' }, {
            stateUpdates: { milestones: ['old'] },
        });

        const resetProfile = await client.resetProfile('p1', {
            profileUpdates: { scenario: 'school', morality: 7 },
            initialRound: { R: 0, story: '新開場' },
        });

        expect(resetProfile).toMatchObject({ id: 'p1', scenario: 'school', morality: 7, lastCommittedRound: 0 });
        expect(await client.saves.getAll('p1')).toMatchObject([{ R: 0, story: '新開場' }]);
        expect(await client.novel.getAll('p1')).toHaveLength(0);
        expect(await client.state.get('p1', 'milestones')).toBeNull();
        client.db.close();
    });

    it('rolls back reset deletions when the replacement profile violates an index', async () => {
        const client = await loadClientDB();
        await client.profiles.create({ id: 'p1', username: '原玩家' });
        await client.profiles.create({ id: 'p2', username: '已佔用名稱' });
        await client.commitRound('p1', { R: 1, story: '不得遺失' }, {
            stateUpdates: { milestones: ['keep'] },
        });

        await expect(client.resetProfile('p1', {
            profileUpdates: { username: '已佔用名稱' },
            initialRound: { R: 0, story: '不應寫入' },
        })).rejects.toThrow();

        expect((await client.profiles.get('p1')).username).toBe('原玩家');
        expect(await client.saves.getAll('p1')).toMatchObject([{ R: 1, story: '不得遺失' }]);
        expect(await client.novel.getAll('p1')).toMatchObject([{ round: 1, story: '不得遺失' }]);
        expect(await client.state.get('p1', 'milestones')).toEqual(['keep']);
        client.db.close();
    });

    it('caches a model-bound epilogue and refuses paid actions after death', async () => {
        const client = await loadClientDB();
        const engine = await import('../../../client/engine/gameEngine.js');
        const aiProxy = (await import('../../../client/ai/aiProxy.js')).default;
        const generate = vi.spyOn(aiProxy, 'generate').mockResolvedValue('唯一結局');

        await client.profiles.create({
            id: 'p1', username: '終局玩家', scenario: 'wuxia', isDeceased: true,
        });
        await client.saves.add('p1', {
            R: 3,
            story: '死亡回合',
            playerState: 'dead',
            EVT: '終局',
            NPC: [],
            epilogueModel: 'openai',
        });
        engine.setActiveProfile('p1');

        const first = await engine.getEpilogue();
        const second = await engine.getEpilogue('minimax');
        expect(first).toMatchObject({ epilogue: '唯一結局', cached: false, model: 'openai' });
        expect(second).toMatchObject({ epilogue: '唯一結局', cached: true, model: 'openai' });
        expect(generate).toHaveBeenCalledOnce();
        expect(generate.mock.calls[0][0]).toBe('epilogue');
        expect(generate.mock.calls[0][1]).toBe('openai');
        expect(await client.state.get('p1', 'epilogue')).toMatchObject({ deathRound: 3, model: 'openai' });

        await expect(engine.interact({ action: '死後仍行動', model: 'openai' }))
            .rejects.toMatchObject({ code: 'GAME_ALREADY_ENDED' });
        expect(generate).toHaveBeenCalledOnce();
        client.db.close();
    });
});
