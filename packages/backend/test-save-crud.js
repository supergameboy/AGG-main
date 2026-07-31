import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const BASE_URL = 'http://localhost:17334/api/v1';
const DB_PATH = 'C:/Users/super/Documents/trae_projects/AGG (2)/packages/game_data/game.db';

const results = [];
let db = null;
let saveId = null;

function log(section, msg) {
  console.log(`  [${section}] ${msg}`);
}

function check(condition, msg, section = 'TEST') {
  if (condition) {
    console.log(`  ✅ [${section}] ${msg}`);
  } else {
    console.log(`  ❌ [${section}] ${msg}`);
    results.push({ section, message: msg });
  }
}

async function apiCall(method, urlPath, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);
  const resp = await fetch(`${BASE_URL}${urlPath}`, options);
  return await resp.json();
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Save CRUD + 复制功能测试                         ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  try {
    // STEP 1: 初始化游戏
    console.log('═'.repeat(50));
    console.log('STEP 1: 初始化游戏');
    console.log('═'.repeat(50));

    const initBody = {
      message: '开始新游戏',
      action: 'initialize',
      data: {
        characterData: {
          name: '测试勇者', race: 'human', classType: 'warrior',
          background: 'noble', attributes: { str: 18, agi: 10, int: 8, vit: 14, luck: 6 }
        },
        templateId: 'fantasy-adventure'
      }
    };

    const initResp = await apiCall('POST', '/agent/chat', initBody);
    check(initResp.success === true, '初始化成功', 'INIT');
    saveId = initResp.data?.data?.saveId || initResp.data?.saveId;
    check(!!saveId, `saveId: ${saveId}`, 'INIT');

    db = new Database(DB_PATH, { readonly: true });

    // STEP 2: 条件查询
    console.log('\n═'.repeat(50));
    console.log('STEP 2: 条件查询存档');
    console.log('═'.repeat(50));

    const allSaves = await apiCall('GET', '/saves');
    check(allSaves.success === true, 'GET /saves 全部存档', 'QUERY');
    log('QUERY', `总存档数: ${allSaves.data?.length}`);

    const filteredSaves = await apiCall('GET', '/saves?templateId=fantasy-adventure');
    check(filteredSaves.success === true, 'GET /saves?templateId=fantasy-adventure', 'QUERY');
    log('QUERY', `fantasy-adventure存档数: ${filteredSaves.data?.length}`);

    const nameSearch = await apiCall('GET', '/saves?nameContains=测试');
    check(nameSearch.success === true, 'GET /saves?nameContains=测试', 'QUERY');
    log('QUERY', `名称含"测试"的存档数: ${nameSearch.data?.length}`);

    const limitedSaves = await apiCall('GET', '/saves?limit=1');
    check(limitedSaves.success === true, 'GET /saves?limit=1', 'QUERY');
    check(limitedSaves.data?.length <= 1, `limit=1生效 (实际=${limitedSaves.data?.length})`, 'QUERY');

    // STEP 3: 更新存档元数据
    console.log('\n═'.repeat(50));
    console.log('STEP 3: 更新存档元数据 (PATCH)');
    console.log('═'.repeat(50));

    const patchResp = await apiCall('PATCH', `/saves/${saveId}`, {
      name: '测试勇者-已改名',
      chapter: '第二章',
      description: '测试描述'
    });
    check(patchResp.success === true, 'PATCH /saves/:id 更新成功', 'UPDATE');
    check(patchResp.data?.name === '测试勇者-已改名', `name=测试勇者-已改名 (实际=${patchResp.data?.name})`, 'UPDATE');
    check(patchResp.data?.chapter === '第二章', `chapter=第二章 (实际=${patchResp.data?.chapter})`, 'UPDATE');

    const emptyPatch = await apiCall('PATCH', `/saves/${saveId}`, {});
    check(emptyPatch.success === false, '空更新返回400', 'UPDATE');

    // STEP 4: 创建快照
    console.log('\n═'.repeat(50));
    console.log('STEP 4: 创建快照');
    console.log('═'.repeat(50));

    const snapshotResp = await apiCall('POST', `/saves/${saveId}/snapshots`, {
      chapterName: '测试快照章节'
    });
    check(snapshotResp.success === true, '创建快照成功', 'SNAPSHOT');
    const snapshotId = snapshotResp.data?.id;
    check(!!snapshotId, `snapshotId: ${snapshotId}`, 'SNAPSHOT');

    // STEP 5: 修改数据后恢复快照
    console.log('\n═'.repeat(50));
    console.log('STEP 5: 修改数据后恢复快照');
    console.log('═'.repeat(50));

    const patchResp2 = await apiCall('PATCH', `/saves/${saveId}`, {
      name: '被修改的名字',
      chapter: '被修改的章节'
    });
    check(patchResp2.success === true, '修改存档名称和章节', 'RESTORE');

    const beforeRestore = await apiCall('GET', `/saves/${saveId}`);
    check(beforeRestore.data?.name === '被修改的名字', '恢复前name=被修改的名字', 'RESTORE');

    const restoreResp = await apiCall('POST', `/saves/${saveId}/snapshots/${snapshotId}/restore`);
    check(restoreResp.success === true, '快照恢复成功', 'RESTORE');
    check(restoreResp.data?.name === '测试勇者-已改名', `恢复后name=测试勇者-已改名 (实际=${restoreResp.data?.name})`, 'RESTORE');
    check(restoreResp.data?.chapter === '第二章', `恢复后chapter=第二章 (实际=${restoreResp.data?.chapter})`, 'RESTORE');

    // STEP 6: 复制存档
    console.log('\n═'.repeat(50));
    console.log('STEP 6: 复制存档 (全量深拷贝)');
    console.log('═'.repeat(50));

    const sourceChar = db.prepare('SELECT * FROM characters WHERE save_id = ?').get(saveId);
    const sourceInv = db.prepare('SELECT * FROM inventory WHERE save_id = ?').all(saveId);
    const sourceSkills = db.prepare('SELECT * FROM character_skills WHERE save_id = ?').all(saveId);
    const sourceNPCs = db.prepare('SELECT * FROM npcs WHERE save_id = ?').all(saveId);
    const sourceQuests = db.prepare('SELECT * FROM quests WHERE save_id = ?').all(saveId);
    const sourceCtx = db.prepare('SELECT * FROM agent_contexts WHERE save_id = ?').all(saveId);
    log('COPY', `源数据: character=${!!sourceChar}, inventory=${sourceInv.length}, skills=${sourceSkills.length}, npcs=${sourceNPCs.length}, quests=${sourceQuests.length}, contexts=${sourceCtx.length}`);

    const copyResp = await apiCall('POST', `/saves/${saveId}/copy`, {
      name: '复制的存档'
    });
    check(copyResp.success === true, 'POST /saves/:id/copy 复制成功', 'COPY');
    const newSaveId = copyResp.data?.id;
    check(!!newSaveId, `新saveId: ${newSaveId}`, 'COPY');
    check(newSaveId !== saveId, '新saveId不同于源saveId', 'COPY');
    check(copyResp.data?.name === '复制的存档', `name=复制的存档 (实际=${copyResp.data?.name})`, 'COPY');

    if (newSaveId) {
      const copiedChar = db.prepare('SELECT * FROM characters WHERE save_id = ?').get(newSaveId);
      check(!!copiedChar, '复制的character存在', 'COPY');
      if (copiedChar) {
        check(copiedChar.name === sourceChar.name, `角色名一致: ${copiedChar.name}`, 'COPY');
      }

      const copiedInv = db.prepare('SELECT * FROM inventory WHERE save_id = ?').all(newSaveId);
      check(copiedInv.length === sourceInv.length, `inventory数量一致: ${copiedInv.length}=${sourceInv.length}`, 'COPY');

      const copiedSkills = db.prepare('SELECT * FROM character_skills WHERE save_id = ?').all(newSaveId);
      check(copiedSkills.length === sourceSkills.length, `skills数量一致: ${copiedSkills.length}=${sourceSkills.length}`, 'COPY');

      const copiedNPCs = db.prepare('SELECT * FROM npcs WHERE save_id = ?').all(newSaveId);
      check(copiedNPCs.length === sourceNPCs.length, `npcs数量一致: ${copiedNPCs.length}=${sourceNPCs.length}`, 'COPY');

      const copiedQuests = db.prepare('SELECT * FROM quests WHERE save_id = ?').all(newSaveId);
      check(copiedQuests.length === sourceQuests.length, `quests数量一致: ${copiedQuests.length}=${sourceQuests.length}`, 'COPY');

      const copiedCtx = db.prepare('SELECT * FROM agent_contexts WHERE save_id = ?').all(newSaveId);
      check(copiedCtx.length === sourceCtx.length, `agent_contexts数量一致: ${copiedCtx.length}=${sourceCtx.length}`, 'COPY');

      const copiedMaps = db.prepare('SELECT * FROM maps WHERE save_id = ?').all(newSaveId);
      const sourceMaps = db.prepare('SELECT * FROM maps WHERE save_id = ?').all(saveId);
      check(copiedMaps.length === sourceMaps.length, `maps数量一致: ${copiedMaps.length}=${sourceMaps.length}`, 'COPY');

      if (copiedMaps.length > 0) {
        const copiedLocs = db.prepare('SELECT * FROM locations WHERE map_id = ?').all(copiedMaps[0].id);
        const sourceLocs = db.prepare('SELECT * FROM locations WHERE map_id = ?').all(sourceMaps[0].id);
        check(copiedLocs.length === sourceLocs.length, `locations数量一致: ${copiedLocs.length}=${sourceLocs.length}`, 'COPY');
      }

      const copiedRelations = db.prepare('SELECT * FROM npc_relations WHERE save_id = ?').all(newSaveId);
      const sourceRelations = db.prepare('SELECT * FROM npc_relations WHERE save_id = ?').all(saveId);
      check(copiedRelations.length === sourceRelations.length, `npc_relations数量一致: ${copiedRelations.length}=${sourceRelations.length}`, 'COPY');
    }

    // STEP 7: 级联删除
    console.log('\n═'.repeat(50));
    console.log('STEP 7: 级联删除验证');
    console.log('═'.repeat(50));

    if (newSaveId) {
      const delResp = await apiCall('DELETE', `/saves/${newSaveId}`);
      check(delResp.success === true, 'DELETE /saves/:id 删除成功', 'DELETE');

      const deletedChar = db.prepare('SELECT * FROM characters WHERE save_id = ?').get(newSaveId);
      check(!deletedChar, '删除后character不存在', 'DELETE');

      const deletedInv = db.prepare('SELECT * FROM inventory WHERE save_id = ?').all(newSaveId);
      check(deletedInv.length === 0, '删除后inventory为空', 'DELETE');

      const deletedSkills = db.prepare('SELECT * FROM character_skills WHERE save_id = ?').all(newSaveId);
      check(deletedSkills.length === 0, '删除后skills为空', 'DELETE');

      const deletedNPCs = db.prepare('SELECT * FROM npcs WHERE save_id = ?').all(newSaveId);
      check(deletedNPCs.length === 0, '删除后npcs为空', 'DELETE');

      const deletedMaps = db.prepare('SELECT * FROM maps WHERE save_id = ?').all(newSaveId);
      check(deletedMaps.length === 0, '删除后maps为空', 'DELETE');

      const deletedCtx = db.prepare('SELECT * FROM agent_contexts WHERE save_id = ?').all(newSaveId);
      check(deletedCtx.length === 0, '删除后agent_contexts为空', 'DELETE');

      const deletedSave = db.prepare('SELECT * FROM saves WHERE id = ?').get(newSaveId);
      check(!deletedSave, '删除后saves记录不存在', 'DELETE');
    }

    // STEP 8: 404测试
    console.log('\n═'.repeat(50));
    console.log('STEP 8: 404错误处理');
    console.log('═'.repeat(50));

    const notFoundLoad = await apiCall('GET', '/saves/nonexistent-id');
    check(notFoundLoad.success === false, 'GET不存在的存档返回失败', '404');

    const notFoundCopy = await apiCall('POST', '/saves/nonexistent-id/copy');
    check(notFoundCopy.success === false, 'COPY不存在的存档返回失败', '404');

    const notFoundRestore = await apiCall('POST', '/saves/nonexistent-id/snapshots/nonexistent-snapshot/restore');
    check(notFoundRestore.success === false, 'RESTORE不存在的快照返回失败', '404');

    // 汇总
    console.log('\n═'.repeat(50));
    console.log(`测试完成! 发现 ${results.length} 个问题`);
    console.log('═'.repeat(50));
    if (results.length > 0) {
      for (const r of results) {
        console.log(`  ❌ [${r.section}] ${r.message}`);
      }
    }

  } catch (error) {
    console.error('测试执行出错:', error);
  } finally {
    if (db) db.close();
  }
}

main();
