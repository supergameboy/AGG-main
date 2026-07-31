import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:17334/api/v1';
const DB_PATH = 'C:/Users/super/Documents/trae_projects/AGG (2)/packages/game_data/game.db';
const LOG_PATH = 'C:/Users/super/Documents/trae_projects/AGG (2)/packages/game_data/logs/session.log';
const RESULT_PATH = 'C:/Users/super/Documents/trae_projects/AGG (2)/packages/backend/test-gameplay-result.json';

const issues = [];
let saveId = null;
let db = null;
const dataSnapshots = {};

function log(section, msg) {
  console.log(`\n  [${section}] ${msg}`);
}

function check(condition, msg, section = 'TEST') {
  if (condition) {
    console.log(`  ✅ [${section}] ${msg}`);
  } else {
    console.log(`  ❌ [${section}] ${msg}`);
    issues.push({ section, message: msg, timestamp: Date.now() });
  }
  return condition;
}

async function apiCall(method, urlPath, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);
  const resp = await fetch(`${BASE_URL}${urlPath}`, options);
  const json = await resp.json();
  return json;
}

function snapshotDB(label) {
  if (!db) return;
  const snap = {};
  const tables = ['saves', 'characters', 'inventory', 'character_skills', 'maps', 'locations', 'npcs', 'npc_relations', 'quests', 'quest_objectives', 'dialogues', 'agent_contexts', 'agent_schedules', 'decision_logs', 'save_game_state', 'save_game_time', 'save_snapshots'];
  for (const t of tables) {
    try {
      const rows = db.prepare(`SELECT * FROM ${t}`).all();
      snap[t] = rows;
    } catch (e) {
      snap[t] = `ERROR: ${e.message}`;
    }
  }
  dataSnapshots[label] = snap;
  return snap;
}

function diffSnapshots(label1, label2) {
  const s1 = dataSnapshots[label1] || {};
  const s2 = dataSnapshots[label2] || {};
  const diffs = {};
  const allTables = new Set([...Object.keys(s1), ...Object.keys(s2)]);
  for (const t of allTables) {
    const r1 = Array.isArray(s1[t]) ? s1[t] : [];
    const r2 = Array.isArray(s2[t]) ? s2[t] : [];
    if (r1.length !== r2.length) {
      diffs[t] = { before: r1.length, after: r2.length, change: r2.length - r1.length };
    }
  }
  return diffs;
}

function getCharacterFromDB() {
  if (!db || !saveId) return null;
  return db.prepare('SELECT * FROM characters WHERE save_id = ?').get(saveId);
}

function getInventoryFromDB() {
  if (!db || !saveId) return [];
  return db.prepare('SELECT * FROM inventory WHERE save_id = ?').all(saveId);
}

function getSkillsFromDB() {
  if (!db || !saveId) return [];
  return db.prepare('SELECT * FROM character_skills WHERE save_id = ?').all(saveId);
}

function getNPCsFromDB() {
  if (!db || !saveId) return [];
  return db.prepare('SELECT * FROM npcs WHERE save_id = ?').all(saveId);
}

function getQuestsFromDB() {
  if (!db || !saveId) return [];
  return db.prepare('SELECT * FROM quests WHERE save_id = ?').all(saveId);
}

function getLocationsFromDB() {
  if (!db || !saveId) return [];
  const maps = db.prepare('SELECT * FROM maps WHERE save_id = ?').all(saveId);
  if (maps.length === 0) return [];
  return db.prepare('SELECT * FROM locations WHERE map_id = ?').all(maps[0].id);
}

function getAgentContextsFromDB() {
  if (!db || !saveId) return [];
  return db.prepare('SELECT * FROM agent_contexts WHERE save_id = ?').all(saveId);
}

function getDialoguesFromDB() {
  if (!db || !saveId) return [];
  return db.prepare('SELECT * FROM dialogues WHERE save_id = ?').all(saveId);
}

function getGameStateFromDB() {
  if (!db || !saveId) return [];
  return db.prepare('SELECT * FROM save_game_state WHERE save_id = ?').all(saveId);
}

function getGameTimeFromDB() {
  if (!db || !saveId) return null;
  return db.prepare('SELECT * FROM save_game_time WHERE save_id = ?').get(saveId);
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     AGG 后端完整游戏流程测试 — 数据流转追踪 & 一致性验证      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  try {
    // ==================== STEP 1: 健康检查 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 1: 健康检查 & 数据库初始化验证');
    console.log('═'.repeat(60));

    const health = await apiCall('GET', '/health');
    check(health.success === true, '健康检查成功', 'HEALTH');

    // 等待数据库创建
    await new Promise(r => setTimeout(r, 1000));
    db = new Database(DB_PATH, { readonly: true });

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const tableNames = tables.map(t => t.name);
    log('DB', `数据库表数量: ${tableNames.length}`);

    const requiredTables = ['saves', 'characters', 'inventory', 'character_skills', 'maps', 'locations', 'npcs', 'quests', 'dialogues', 'agent_contexts', 'save_game_state', 'save_game_time'];
    for (const t of requiredTables) {
      check(tableNames.includes(t), `表 ${t} 存在`, 'DB');
    }

    snapshotDB('before_init');

    // ==================== STEP 2: 角色初始化 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 2: 角色初始化 (fantasy-adventure / human / warrior / noble)');
    console.log('═'.repeat(60));

    const charData = {
      name: '亚瑟',
      race: 'human',
      classType: 'warrior',
      background: 'noble',
      attributes: { str: 18, agi: 10, int: 8, vit: 14, luck: 6 }
    };

    const initBody = {
      message: '开始新游戏',
      action: 'initialize',
      data: {
        characterData: charData,
        templateId: 'fantasy-adventure'
      }
    };

    const initResp = await apiCall('POST', '/agent/chat', initBody);
    check(initResp.success === true, '初始化请求成功', 'INIT');

    saveId = initResp.data?.data?.saveId || initResp.data?.saveId;
    check(!!saveId, `saveId已生成: ${saveId}`, 'INIT');

    if (!saveId) {
      console.log('  ❌ 无法获取saveId，终止测试');
      return;
    }

    // ==================== STEP 3: 初始化数据DB验证 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 3: 初始化数据DB验证 — 数据流转追踪');
    console.log('═'.repeat(60));

    // 3.1 saves表
    const saveRow = db.prepare('SELECT * FROM saves WHERE id = ?').get(saveId);
    check(!!saveRow, 'saves表有记录', 'SAVE');
    if (saveRow) {
      check(saveRow.template_id === 'fantasy-adventure', `template_id=fantasy-adventure (实际=${saveRow.template_id})`, 'SAVE');
      check(saveRow.game_mode === 'story', `game_mode=story (实际=${saveRow.game_mode})`, 'SAVE');
      check(saveRow.level === 1, `level=1 (实际=${saveRow.level})`, 'SAVE');
      log('SAVE', `name=${saveRow.name}, type=${saveRow.type}, chapter="${saveRow.chapter}"`);
    }

    // 3.2 characters表 — 追踪属性数据流
    const charRow = getCharacterFromDB();
    check(!!charRow, 'characters表有记录', 'CHAR');
    if (charRow) {
      check(charRow.name === '亚瑟', `name=亚瑟 (实际=${charRow.name})`, 'CHAR');
      check(charRow.race === 'human', `race=human (实际=${charRow.race})`, 'CHAR');
      check(charRow.class === 'warrior', `class=warrior (实际=${charRow.class})`, 'CHAR');
      check(charRow.background === 'noble', `background=noble (实际=${charRow.background})`, 'CHAR');
      check(charRow.level === 1, `level=1 (实际=${charRow.level})`, 'CHAR');
      check(charRow.gold === 200, `gold=200 (noble背景, 实际=${charRow.gold})`, 'CHAR');
      check(charRow.health > 0, `health>0 (实际=${charRow.health})`, 'CHAR');
      check(charRow.mana > 0, `mana>0 (实际=${charRow.mana})`, 'CHAR');
      check(charRow.health <= charRow.max_health, `health<=max_health (${charRow.health}/${charRow.max_health})`, 'CHAR');
      check(charRow.mana <= charRow.max_mana, `mana<=max_mana (${charRow.mana}/${charRow.max_mana})`, 'CHAR');

      const attrs = typeof charRow.attributes === 'string' ? JSON.parse(charRow.attributes) : charRow.attributes;
      check(attrs.str === 18, `attributes.str=18 (实际=${attrs.str})`, 'CHAR');
      check(attrs.agi === 10, `attributes.agi=10 (实际=${attrs.agi})`, 'CHAR');
      check(attrs.int === 8, `attributes.int=8 (实际=${attrs.int})`, 'CHAR');
      check(attrs.vit === 14, `attributes.vit=14 (实际=${attrs.vit})`, 'CHAR');
      check(attrs.luck === 6, `attributes.luck=6 (实际=${attrs.luck})`, 'CHAR');

      log('CHAR', `HP=${charRow.health}/${charRow.max_health}, MP=${charRow.mana}/${charRow.max_mana}, gold=${charRow.gold}, exp=${charRow.experience}`);
      log('CHAR', `location=${charRow.current_location_id}, level=${charRow.level}`);
    }

    // 3.3 inventory表 — 追踪物品数据流
    const invRows = getInventoryFromDB();
    check(invRows.length >= 2, `inventory表有>=2件物品 (实际=${invRows.length})`, 'INV');
    const equipped = invRows.filter(i => i.equipped === 1 || i.equipped === true);
    check(equipped.length >= 1, `有装备的物品>=1 (实际=${equipped.length})`, 'INV');
    for (const item of invRows) {
      check(item.quality !== null && item.quality !== undefined, `${item.name} quality=${item.quality}`, 'INV');
      check(item.durability !== null && item.durability !== undefined, `${item.name} durability=${item.durability}`, 'INV');
      check(item.max_durability !== null && item.max_durability !== undefined, `${item.name} max_durability=${item.max_durability}`, 'INV');
      if (item.equipped) {
        check(!!item.equipped_slot, `装备 ${item.name} equipped_slot=${item.equipped_slot}`, 'INV');
      }
      log('INV', `  ${item.name}: qty=${item.quantity}, equipped=${item.equipped}, slot=${item.equipped_slot || '-'}, quality=${item.quality}`);
    }

    // 3.4 character_skills表
    const skillRows = getSkillsFromDB();
    check(skillRows.length >= 2, `character_skills表有>=2个技能 (实际=${skillRows.length})`, 'SKILL');
    for (const s of skillRows) {
      log('SKILL', `  ${s.skill_id}: level=${s.current_level}, type=${s.skill_type}`);
    }

    // 3.5 maps + locations
    const locRows = getLocationsFromDB();
    check(locRows.length >= 1, `locations表有>=1个位置 (实际=${locRows.length})`, 'MAP');
    for (const l of locRows) {
      log('MAP', `  ${l.name || l.id}: type=${l.location_type}`);
    }

    // 3.6 npcs
    const npcRows = getNPCsFromDB();
    check(npcRows.length >= 1, `npcs表有>=1个NPC (实际=${npcRows.length})`, 'NPC');
    for (const n of npcRows) {
      log('NPC', `  ${n.name}: role=${n.role}, attitude=${n.attitude}`);
    }

    // 3.7 quests
    const questRows = getQuestsFromDB();
    check(questRows.length >= 1, `quests表有>=1个任务 (实际=${questRows.length})`, 'QUEST');
    for (const q of questRows) {
      log('QUEST', `  ${q.name}: status=${q.status}, type=${q.type}`);
    }

    // 3.8 game_time
    const gameTime = getGameTimeFromDB();
    check(!!gameTime, 'save_game_time表有记录', 'TIME');
    if (gameTime) {
      log('TIME', `day=${gameTime.current_day}, hour=${gameTime.current_hour}, minute=${gameTime.current_minute}`);
    }

    // 3.9 agent_contexts
    const ctxRows = getAgentContextsFromDB();
    log('CTX', `agent_contexts记录数: ${ctxRows.length}`);

    snapshotDB('after_init');

    // ==================== STEP 4: 探索交互 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 4: 探索交互 — 追踪数据变化');
    console.log('═'.repeat(60));

    const charBeforeExplore = getCharacterFromDB();
    const exploreBody = {
      message: '我想探索附近的森林',
      action: 'explore',
      data: { saveId }
    };

    const exploreResp = await apiCall('POST', '/agent/chat', exploreBody);
    check(exploreResp.success === true, '探索请求成功', 'EXPLORE');

    const charAfterExplore = getCharacterFromDB();
    check(!!charAfterExplore, '探索后character仍存在', 'EXPLORE');
    check(charAfterExplore.name === '亚瑟', '探索后角色名未变', 'EXPLORE');
    check(charAfterExplore.gold === charBeforeExplore.gold, `探索后金币未变 (${charAfterExplore.gold})`, 'EXPLORE');
    check(charAfterExplore.level === charBeforeExplore.level, `探索后等级未变 (${charAfterExplore.level})`, 'EXPLORE');

    const ctxAfterExplore = getAgentContextsFromDB();
    log('EXPLORE', `agent_contexts记录数: ${ctxAfterExplore.length} (初始化后: ${ctxRows.length})`);

    const gameStateAfterExplore = getGameStateFromDB();
    log('EXPLORE', `save_game_state记录数: ${gameStateAfterExplore.length}`);

    snapshotDB('after_explore');
    const diff1 = diffSnapshots('after_init', 'after_explore');
    log('DIFF', `探索后数据变化: ${JSON.stringify(diff1)}`);

    // ==================== STEP 5: NPC对话 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 5: NPC对话 — 追踪对话数据持久化');
    console.log('═'.repeat(60));

    const npcList = getNPCsFromDB();
    const targetNpc = npcList[0];

    const dialogueBody = {
      message: `你好，我想和${targetNpc?.name || '旅店老板'}聊天`,
      action: 'dialogue',
      data: { saveId, npcId: targetNpc?.id }
    };

    const dialogueResp = await apiCall('POST', '/agent/chat', dialogueBody);
    check(dialogueResp.success === true, '对话请求成功', 'DIALOGUE');

    const dialogueRows = getDialoguesFromDB();
    check(dialogueRows.length > 0, `dialogues表有记录 (数量=${dialogueRows.length})`, 'DIALOGUE');
    for (const d of dialogueRows.slice(-3)) {
      log('DIALOGUE', `  speaker=${d.speaker}, type=${d.dialogue_type}, content长度=${(d.content || '').length}`);
    }

    const charAfterDialogue = getCharacterFromDB();
    check(charAfterDialogue.name === '亚瑟', '对话后角色名未变', 'DIALOGUE');
    check(charAfterDialogue.gold === charAfterExplore.gold, `对话后金币未变 (${charAfterDialogue.gold})`, 'DIALOGUE');

    snapshotDB('after_dialogue');
    const diff2 = diffSnapshots('after_explore', 'after_dialogue');
    log('DIFF', `对话后数据变化: ${JSON.stringify(diff2)}`);

    // ==================== STEP 6: 战斗 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 6: 战斗 — 追踪战斗状态持久化');
    console.log('═'.repeat(60));

    const combatBody = {
      message: '我遇到了一只哥布林，准备战斗！',
      action: 'combat',
      data: { saveId }
    };

    const combatResp = await apiCall('POST', '/agent/chat', combatBody);
    check(combatResp.success === true, '战斗请求成功', 'COMBAT');

    const combatCtx = db.prepare("SELECT * FROM agent_contexts WHERE save_id = ? AND agent_type = 'combat'").get(saveId);
    check(!!combatCtx, '战斗状态已持久化到agent_contexts', 'COMBAT');
    if (combatCtx) {
      const combatState = JSON.parse(combatCtx.state || '{}');
      log('COMBAT', `combat state keys: ${Object.keys(combatState).join(', ')}`);
    }

    const charAfterCombat = getCharacterFromDB();
    check(charAfterCombat.name === '亚瑟', '战斗后角色名未变', 'COMBAT');
    check(charAfterCombat.health > 0, `战斗后HP>0 (实际=${charAfterCombat.health})`, 'COMBAT');
    check(charAfterCombat.health <= charAfterCombat.max_health, `战斗后HP<=maxHP (${charAfterCombat.health}/${charAfterCombat.max_health})`, 'COMBAT');

    snapshotDB('after_combat');
    const diff3 = diffSnapshots('after_dialogue', 'after_combat');
    log('DIFF', `战斗后数据变化: ${JSON.stringify(diff3)}`);

    // ==================== STEP 7: 技能使用 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 7: 技能使用 — 追踪技能数据');
    console.log('═'.repeat(60));

    const skillBody = {
      message: '我想使用斩击技能',
      action: 'skill_use',
      data: { saveId }
    };

    const skillResp = await apiCall('POST', '/agent/chat', skillBody);
    check(skillResp.success === true, '技能请求成功', 'SKILL');

    const skillsAfterUse = getSkillsFromDB();
    check(skillsAfterUse.length >= 2, `技能数量>=2 (实际=${skillsAfterUse.length})`, 'SKILL');

    snapshotDB('after_skill');
    const diff4 = diffSnapshots('after_combat', 'after_skill');
    log('DIFF', `技能使用后数据变化: ${JSON.stringify(diff4)}`);

    // ==================== STEP 8: 物品/背包操作 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 8: 物品操作 — 追踪背包数据');
    console.log('═'.repeat(60));

    const invBody = {
      message: '查看我的背包',
      action: 'check_inventory',
      data: { saveId }
    };

    const invResp = await apiCall('POST', '/agent/chat', invBody);
    check(invResp.success === true, '背包查看请求成功', 'INV');

    const invAfter = getInventoryFromDB();
    check(invAfter.length >= 2, `背包物品>=2 (实际=${invAfter.length})`, 'INV');

    const charAfterInv = getCharacterFromDB();
    check(charAfterInv.name === '亚瑟', '背包操作后角色名未变', 'INV');

    snapshotDB('after_inventory');
    const diff5 = diffSnapshots('after_skill', 'after_inventory');
    log('DIFF', `背包操作后数据变化: ${JSON.stringify(diff5)}`);

    // ==================== STEP 9: 任务查看 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 9: 任务查看 — 追踪任务数据');
    console.log('═'.repeat(60));

    const questBody = {
      message: '查看我的任务',
      action: 'quest_check',
      data: { saveId }
    };

    const questResp = await apiCall('POST', '/agent/chat', questBody);
    check(questResp.success === true, '任务查看请求成功', 'QUEST');

    const questsAfter = getQuestsFromDB();
    check(questsAfter.length >= 1, `任务数量>=1 (实际=${questsAfter.length})`, 'QUEST');

    snapshotDB('after_quest');

    // ==================== STEP 10: Save API验证 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 10: Save API验证 — 存档管理数据流');
    console.log('═'.repeat(60));

    const savesListResp = await apiCall('GET', '/saves');
    check(savesListResp.success === true, 'GET /saves 成功', 'SAVE-API');
    const mySave = savesListResp.data?.find(s => s.id === saveId);
    check(!!mySave, `当前存档在列表中 (id=${saveId})`, 'SAVE-API');

    const loadResp = await apiCall('GET', `/saves/${saveId}`);
    check(loadResp.success === true, `GET /saves/${saveId} 成功`, 'SAVE-API');
    check(loadResp.data?.character?.name === '亚瑟', `加载存档角色名=亚瑟 (实际=${loadResp.data?.character?.name})`, 'SAVE-API');
    check(loadResp.data?.character?.race === 'human', `加载存档种族=human (实际=${loadResp.data?.character?.race})`, 'SAVE-API');
    check(loadResp.data?.character?.class === 'warrior', `加载存档职业=warrior (实际=${loadResp.data?.character?.class})`, 'SAVE-API');

    const snapshotResp = await apiCall('POST', `/saves/${saveId}/snapshots`, { chapterName: 'test-chapter' });
    check(snapshotResp.success === true, 'POST /saves/:id/snapshots 创建快照成功', 'SAVE-API');

    const snapshotsListResp = await apiCall('GET', `/saves/${saveId}/snapshots`);
    check(snapshotsListResp.success === true, 'GET /saves/:id/snapshots 获取快照列表成功', 'SAVE-API');
    check(snapshotsListResp.data?.length >= 1, `快照数量>=1 (实际=${snapshotsListResp.data?.length})`, 'SAVE-API');

    // ==================== STEP 11: 最终数据一致性验证 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 11: 最终数据一致性验证 — 全量对比');
    console.log('═'.repeat(60));

    const finalChar = getCharacterFromDB();
    check(!!finalChar, '最终character存在', 'FINAL');
    if (finalChar) {
      check(finalChar.name === '亚瑟', `角色名=亚瑟 (实际=${finalChar.name})`, 'FINAL');
      check(finalChar.race === 'human', `种族=human (实际=${finalChar.race})`, 'FINAL');
      check(finalChar.class === 'warrior', `职业=warrior (实际=${finalChar.class})`, 'FINAL');
      check(finalChar.background === 'noble', `背景=noble (实际=${finalChar.background})`, 'FINAL');
      check(finalChar.health > 0, `HP>0 (实际=${finalChar.health})`, 'FINAL');
      check(finalChar.health <= finalChar.max_health, `HP<=maxHP (${finalChar.health}/${finalChar.max_health})`, 'FINAL');
      check(finalChar.mana <= finalChar.max_mana, `MP<=maxMP (${finalChar.mana}/${finalChar.max_mana})`, 'FINAL');
      check(finalChar.gold >= 0, `gold>=0 (实际=${finalChar.gold})`, 'FINAL');
      check(finalChar.level >= 1, `level>=1 (实际=${finalChar.level})`, 'FINAL');
    }

    const finalInv = getInventoryFromDB();
    for (const item of finalInv) {
      check(item.durability <= item.max_durability, `${item.name} durability<=max_durability (${item.durability}/${item.max_durability})`, 'FINAL');
    }

    const finalSkills = getSkillsFromDB();
    check(finalSkills.length >= 2, `技能数量>=2 (实际=${finalSkills.length})`, 'FINAL');

    const finalNPCs = getNPCsFromDB();
    check(finalNPCs.length >= 1, `NPC数量>=1 (实际=${finalNPCs.length})`, 'FINAL');

    const finalQuests = getQuestsFromDB();
    check(finalQuests.length >= 1, `任务数量>=1 (实际=${finalQuests.length})`, 'FINAL');

    const finalCtx = getAgentContextsFromDB();
    log('FINAL', `agent_contexts持久化的Agent类型: ${finalCtx.map(c => c.agent_type).join(', ')}`);

    const finalGameState = getGameStateFromDB();
    log('FINAL', `save_game_state记录数: ${finalGameState.length}`);
    for (const gs of finalGameState) {
      log('FINAL', `  ${gs.data_type}.${gs.data_key} = ${gs.data_value}`);
    }

    snapshotDB('final');

    // ==================== 数据流转汇总 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('数据流转汇总 — 各阶段数据变化');
    console.log('═'.repeat(60));

    const stages = ['before_init', 'after_init', 'after_explore', 'after_dialogue', 'after_combat', 'after_skill', 'after_inventory', 'after_quest', 'final'];
    for (let i = 1; i < stages.length; i++) {
      const diff = diffSnapshots(stages[i - 1], stages[i]);
      const changes = Object.entries(diff).map(([t, d]) => `${t}: ${d.before}→${d.after}`).join(', ');
      if (changes) {
        log('FLOW', `${stages[i - 1]} → ${stages[i]}: ${changes}`);
      } else {
        log('FLOW', `${stages[i - 1]} → ${stages[i]}: 无变化`);
      }
    }

    // ==================== 问题汇总 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('📋 问题汇总');
    console.log('═'.repeat(60));

    if (issues.length === 0) {
      console.log('  ✅ 未发现问题');
    } else {
      console.log(`  发现 ${issues.length} 个问题:`);
      for (const i of issues) {
        console.log(`    ❌ [${i.section}] ${i.message}`);
      }
    }

    // ==================== 保存结果 ====================
    const result = {
      timestamp: Date.now(),
      saveId,
      character: charData,
      issues,
      dataSnapshots: Object.fromEntries(
        Object.entries(dataSnapshots).map(([k, v]) => [k, Object.fromEntries(
          Object.entries(v).map(([t, rows]) => [t, Array.isArray(rows) ? rows.length : rows])
        )])
      ),
      finalState: {
        character: finalChar ? { name: finalChar.name, race: finalChar.race, class: finalChar.class, level: finalChar.level, gold: finalChar.gold, hp: `${finalChar.health}/${finalChar.max_health}`, mp: `${finalChar.mana}/${finalChar.max_mana}` } : null,
        inventory: finalInv.length,
        skills: finalSkills.length,
        npcs: finalNPCs.length,
        quests: finalQuests.length,
        agentContexts: finalCtx.length,
        dialogues: getDialoguesFromDB().length,
        gameState: finalGameState.length
      }
    };

    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    log('RESULT', `测试结果已保存到 ${RESULT_PATH}`);

    console.log('\n' + '═'.repeat(60));
    console.log(`测试完成! 发现 ${issues.length} 个问题`);
    console.log('═'.repeat(60));

  } catch (error) {
    console.error('测试执行出错:', error);
    issues.push({ section: 'SYSTEM', message: error.message, timestamp: Date.now() });
  } finally {
    if (db) db.close();
  }
}

main();
