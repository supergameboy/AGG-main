import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:17334/api/v1';
const DB_PATH = 'C:/Users/super/Documents/trae_projects/AGG (2)/packages/game_data/game.db';
const LOG_PATH = 'C:/Users/super/Documents/trae_projects/AGG (2)/game_data/logs/session.log';
const RESULT_PATH = 'C:/Users/super/Documents/trae_projects/AGG (2)/packages/backend/test-memory-result.json';

const issues = [];
let saveId = null;
let db = null;
const dataSnapshots = {};
const tradeInfo = { npcName: '', itemSold: '', price: 0 };

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
  const tables = ['saves', 'characters', 'inventory', 'character_skills', 'maps', 'locations', 'npcs', 'npc_relations', 'quests', 'quest_objectives', 'dialogues', 'agent_contexts', 'agent_schedules', 'decision_logs', 'save_game_state', 'save_game_time', 'save_snapshots', 'location_connections', 'discovered_locations'];
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

function getNPCRelationsFromDB() {
  if (!db || !saveId) return [];
  return db.prepare('SELECT * FROM npc_relations WHERE save_id = ?').all(saveId);
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

function getDecisionLogsFromDB() {
  if (!db || !saveId) return [];
  return db.prepare('SELECT * FROM decision_logs WHERE save_id = ? ORDER BY timestamp DESC LIMIT 30').all(saveId);
}

function deepInspectAgentContext(agentType) {
  if (!db || !saveId) return null;
  const row = db.prepare('SELECT * FROM agent_contexts WHERE save_id = ? AND agent_type = ?').get(saveId, agentType);
  if (!row) return null;
  const messages = JSON.parse(row.messages || '[]');
  const state = JSON.parse(row.state || '{}');
  return { agentType, messageCount: messages.length, stateKeys: Object.keys(state), state, messages: messages.slice(-5), updatedAt: row.updated_at };
}

function printAgentContextSummary(label) {
  const ctxRows = getAgentContextsFromDB();
  log(label, `agent_contexts 持久化记录数: ${ctxRows.length}`);
  for (const ctx of ctxRows) {
    const messages = JSON.parse(ctx.messages || '[]');
    const state = JSON.parse(ctx.state || '{}');
    log(label, `  ${ctx.agent_type}: messages=${messages.length}, stateKeys=[${Object.keys(state).join(',')}]`);
    const userMsgs = messages.filter(m => m.role === 'user');
    const assistantMsgs = messages.filter(m => m.role === 'assistant');
    log(label, `    user消息=${userMsgs.length}, assistant消息=${assistantMsgs.length}`);
    if (userMsgs.length > 0) {
      const lastUserMsg = userMsgs[userMsgs.length - 1];
      const preview = (lastUserMsg.content || '').substring(0, 80);
      log(label, `    最后user消息: "${preview}..."`);
    }
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  AGG 后端完整游戏流程测试 — 记忆回溯 & 上下文历史 & 数据一致性     ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  try {
    // ==================== STEP 1: 健康检查 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 1: 健康检查 & 数据库初始化验证');
    console.log('═'.repeat(60));

    const health = await apiCall('GET', '/health');
    check(health.success === true, '健康检查成功', 'HEALTH');
    check(health.data?.migrations?.applied === 20, `迁移数=20 (实际=${health.data?.migrations?.applied})`, 'HEALTH');

    await new Promise(r => setTimeout(r, 1000));
    db = new Database(DB_PATH, { readonly: true });

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const tableNames = tables.map(t => t.name);
    log('DB', `数据库表数量: ${tableNames.length}`);

    const requiredTables = ['saves', 'characters', 'inventory', 'character_skills', 'maps', 'locations', 'npcs', 'npc_relations', 'quests', 'dialogues', 'agent_contexts', 'save_game_state', 'save_game_time', 'location_connections', 'discovered_locations'];
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

    const saveRow = db.prepare('SELECT * FROM saves WHERE id = ?').get(saveId);
    check(!!saveRow, 'saves表有记录', 'SAVE');
    if (saveRow) {
      check(saveRow.template_id === 'fantasy-adventure', `template_id=fantasy-adventure (实际=${saveRow.template_id})`, 'SAVE');
      check(saveRow.level === 1, `level=1 (实际=${saveRow.level})`, 'SAVE');
      log('SAVE', `name=${saveRow.name}, type=${saveRow.type}, chapter="${saveRow.chapter}"`);
    }

    const charRow = getCharacterFromDB();
    check(!!charRow, 'characters表有记录', 'CHAR');
    if (charRow) {
      check(charRow.name === '亚瑟', `name=亚瑟 (实际=${charRow.name})`, 'CHAR');
      check(charRow.race === 'human', `race=human (实际=${charRow.race})`, 'CHAR');
      check(charRow.class === 'warrior', `class=warrior (实际=${charRow.class})`, 'CHAR');
      check(charRow.background === 'noble', `background=noble (实际=${charRow.background})`, 'CHAR');
      check(charRow.gold === 200, `gold=200 (noble背景, 实际=${charRow.gold})`, 'CHAR');
      check(charRow.health > 0, `health>0 (实际=${charRow.health})`, 'CHAR');
      check(charRow.health <= charRow.max_health, `health<=max_health (${charRow.health}/${charRow.max_health})`, 'CHAR');
      check(charRow.mana <= charRow.max_mana, `mana<=max_mana (${charRow.mana}/${charRow.max_mana})`, 'CHAR');

      const attrs = typeof charRow.attributes === 'string' ? JSON.parse(charRow.attributes) : charRow.attributes;
      check(attrs.str === 18, `attributes.str=18 (实际=${attrs.str})`, 'CHAR');
      check(attrs.vit === 14, `attributes.vit=14 (实际=${attrs.vit})`, 'CHAR');

      log('CHAR', `HP=${charRow.health}/${charRow.max_health}, MP=${charRow.mana}/${charRow.max_mana}, gold=${charRow.gold}`);
      log('CHAR', `location=${charRow.current_location_id}, level=${charRow.level}`);
    }

    const invRows = getInventoryFromDB();
    check(invRows.length >= 2, `inventory表有>=2件物品 (实际=${invRows.length})`, 'INV');
    const equipped = invRows.filter(i => i.equipped === 1 || i.equipped === true);
    check(equipped.length >= 1, `有装备的物品>=1 (实际=${equipped.length})`, 'INV');
    for (const item of invRows) {
      check(item.quality !== null && item.quality !== undefined, `${item.name} quality=${item.quality}`, 'INV');
      check(item.durability !== null && item.durability !== undefined, `${item.name} durability=${item.durability}`, 'INV');
      check(item.max_durability !== null && item.max_durability !== undefined, `${item.name} max_durability=${item.max_durability}`, 'INV');
    }

    const skillRows = getSkillsFromDB();
    check(skillRows.length >= 2, `character_skills表有>=2个技能 (实际=${skillRows.length})`, 'SKILL');

    const locRows = getLocationsFromDB();
    check(locRows.length >= 1, `locations表有>=1个位置 (实际=${locRows.length})`, 'MAP');

    const npcRows = getNPCsFromDB();
    check(npcRows.length >= 1, `npcs表有>=1个NPC (实际=${npcRows.length})`, 'NPC');
    for (const n of npcRows) {
      log('NPC', `  ${n.name}: role=${n.role}, attitude=${n.attitude}`);
    }

    const questRows = getQuestsFromDB();
    check(questRows.length >= 1, `quests表有>=1个任务 (实际=${questRows.length})`, 'QUEST');

    const gameTime = getGameTimeFromDB();
    check(!!gameTime, 'save_game_time表有记录', 'TIME');

    snapshotDB('after_init');

    // ==================== STEP 4: NPC对话 — 建立记忆锚点 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 4: NPC对话 — 建立记忆锚点（与商人交易）');
    console.log('═'.repeat(60));

    const npcList = getNPCsFromDB();
    const merchantNpc = npcList.find(n => n.role === 'merchant') || npcList[0];
    tradeInfo.npcName = merchantNpc?.name || '旅店老板';

    const tradeBody = {
      message: `你好${tradeInfo.npcName}，我想和你做一笔交易。我有一把旧剑想卖给你，你愿意出多少钱？`,
      action: 'dialogue',
      data: { saveId, npcId: merchantNpc?.id }
    };

    const tradeResp = await apiCall('POST', '/agent/chat', tradeBody);
    check(tradeResp.success === true, '交易对话请求成功', 'TRADE');

    const dialogueAfterTrade = getDialoguesFromDB();
    check(dialogueAfterTrade.length > 0, `dialogues表有记录 (数量=${dialogueAfterTrade.length})`, 'TRADE');

    const charAfterTrade = getCharacterFromDB();
    check(charAfterTrade.name === '亚瑟', '交易后角色名未变', 'TRADE');

    const npcRelationsAfterTrade = getNPCRelationsFromDB();
    log('TRADE', `NPC关系记录数: ${npcRelationsAfterTrade.length}`);
    for (const rel of npcRelationsAfterTrade) {
      log('TRADE', `  NPC=${rel.npc_id}, type=${rel.relation_type}, value=${rel.affection || rel.trust || 'N/A'}`);
    }

    printAgentContextSummary('TRADE');

    snapshotDB('after_trade');
    const diff1 = diffSnapshots('after_init', 'after_trade');
    log('DIFF', `交易后数据变化: ${JSON.stringify(diff1)}`);

    // ==================== STEP 5: 中间对话 — 增加上下文深度 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 5: 中间对话 — 增加上下文深度（3轮无关对话）');
    console.log('═'.repeat(60));

    const midTopics = [
      '这附近有什么有趣的地方吗？',
      '你能告诉我关于这个城镇的历史吗？',
      '最近有什么传闻吗？'
    ];

    for (let i = 0; i < midTopics.length; i++) {
      const midBody = {
        message: midTopics[i],
        action: 'chat',
        data: { saveId }
      };
      const midResp = await apiCall('POST', '/agent/chat', midBody);
      check(midResp.success === true, `中间对话${i + 1}请求成功`, 'MID-CHAT');
      log('MID-CHAT', `第${i + 1}轮中间对话完成`);
    }

    const dialoguesAfterMid = getDialoguesFromDB();
    log('MID-CHAT', `对话记录总数: ${dialoguesAfterMid.length}`);

    printAgentContextSummary('MID-CHAT');

    snapshotDB('after_mid_chat');

    // ==================== STEP 6: 记忆回溯测试 — 关键验证 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 6: 记忆回溯测试 — 询问之前的交易内容');
    console.log('═'.repeat(60));

    const memoryBody = {
      message: '我之前和谁做过交易？卖了什么东西？卖了多少钱？',
      action: 'chat',
      data: { saveId }
    };

    const memoryResp = await apiCall('POST', '/agent/chat', memoryBody);
    check(memoryResp.success === true, '记忆回溯请求成功', 'MEMORY');

    const memoryContent = memoryResp.data?.message || memoryResp.data?.data?.message || '';
    const memoryStr = JSON.stringify(memoryResp.data || {});
    log('MEMORY', `记忆回溯响应长度: ${memoryStr.length}`);

    const mentionsNpcName = memoryStr.includes(tradeInfo.npcName) || memoryContent.includes(tradeInfo.npcName);
    check(mentionsNpcName, `记忆回溯提到了交易NPC: ${tradeInfo.npcName}`, 'MEMORY');

    const mentionsTrade = memoryStr.includes('交易') || memoryStr.includes('卖') || memoryStr.includes('剑') || memoryContent.includes('交易') || memoryContent.includes('卖');
    check(mentionsTrade, '记忆回溯提到了交易/卖/剑相关内容', 'MEMORY');

    const ctxAfterMemory = getAgentContextsFromDB();
    log('MEMORY', `记忆回溯后agent_contexts记录数: ${ctxAfterMemory.length}`);

    for (const ctx of ctxAfterMemory) {
      const messages = JSON.parse(ctx.messages || '[]');
      const userMsgs = messages.filter(m => m.role === 'user');
      log('MEMORY', `  ${ctx.agent_type}: 总消息=${messages.length}, user消息=${userMsgs.length}`);
      if (userMsgs.length > 0) {
        const lastUserMsg = userMsgs[userMsgs.length - 1];
        const preview = (lastUserMsg.content || '').substring(0, 60);
        log('MEMORY', `    最后user消息: "${preview}"`);
      }
    }

    snapshotDB('after_memory');

    // ==================== STEP 7: 探索交互 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 7: 探索交互 — 追踪数据变化');
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

    const locConns = db.prepare('SELECT * FROM location_connections WHERE from_location_id = ?').all(charAfterExplore.current_location_id);
    log('EXPLORE', `location_connections记录数: ${locConns.length}`);

    const discoveredLocs = db.prepare('SELECT * FROM discovered_locations WHERE save_id = ?').all(saveId);
    log('EXPLORE', `discovered_locations记录数: ${discoveredLocs.length}`);

    snapshotDB('after_explore');

    // ==================== STEP 8: 战斗 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 8: 战斗 — 追踪战斗状态持久化');
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
      const combatMessages = JSON.parse(combatCtx.messages || '[]');
      log('COMBAT', `combat messages count: ${combatMessages.length}`);
    }

    const charAfterCombat = getCharacterFromDB();
    check(charAfterCombat.name === '亚瑟', '战斗后角色名未变', 'COMBAT');
    check(charAfterCombat.health > 0, `战斗后HP>0 (实际=${charAfterCombat.health})`, 'COMBAT');
    check(charAfterCombat.health <= charAfterCombat.max_health, `战斗后HP<=maxHP (${charAfterCombat.health}/${charAfterCombat.max_health})`, 'COMBAT');

    snapshotDB('after_combat');

    // ==================== STEP 9: 战斗后再次记忆回溯 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 9: 战斗后再次记忆回溯 — 验证长期记忆保持');
    console.log('═'.repeat(60));

    const memory2Body = {
      message: '我之前和那个商人做了什么交易来着？你还记得吗？',
      action: 'chat',
      data: { saveId }
    };

    const memory2Resp = await apiCall('POST', '/agent/chat', memory2Body);
    check(memory2Resp.success === true, '第二次记忆回溯请求成功', 'MEMORY2');

    const memory2Str = JSON.stringify(memory2Resp.data || {});
    const mentionsTrade2 = memory2Str.includes('交易') || memory2Str.includes('卖') || memory2Str.includes('剑') || memory2Str.includes(tradeInfo.npcName);
    check(mentionsTrade2, '第二次记忆回溯仍能回忆起交易内容', 'MEMORY2');

    log('MEMORY2', '长期记忆保持验证完成');

    snapshotDB('after_memory2');

    // ==================== STEP 10: 技能使用 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 10: 技能使用 — 追踪技能数据');
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

    // ==================== STEP 11: 物品/背包操作 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 11: 物品操作 — 追踪背包数据');
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

    snapshotDB('after_inventory');

    // ==================== STEP 12: 任务查看 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 12: 任务查看 — 追踪任务数据');
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

    // ==================== STEP 13: Save API验证 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 13: Save API验证 — 存档管理数据流');
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

    const snapshotResp = await apiCall('POST', `/saves/${saveId}/snapshots`, { chapterName: 'memory-test-chapter' });
    check(snapshotResp.success === true, 'POST /saves/:id/snapshots 创建快照成功', 'SAVE-API');

    const snapshotsListResp = await apiCall('GET', `/saves/${saveId}/snapshots`);
    check(snapshotsListResp.success === true, 'GET /saves/:id/snapshots 获取快照列表成功', 'SAVE-API');
    check(snapshotsListResp.data?.length >= 1, `快照数量>=1 (实际=${snapshotsListResp.data?.length})`, 'SAVE-API');

    // ==================== STEP 14: 深度上下文历史验证 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 14: 深度上下文历史验证 — agent_contexts消息追踪');
    console.log('═'.repeat(60));

    const allCtxRows = getAgentContextsFromDB();
    log('DEEP-CTX', `agent_contexts持久化记录总数: ${allCtxRows.length}`);

    const expectedAgents = ['coordinator', 'dialogue', 'combat', 'story_context', 'map', 'npc_party', 'inventory', 'skill', 'numerical', 'ui', 'event'];
    const persistedAgents = allCtxRows.map(c => c.agent_type);
    log('DEEP-CTX', `已持久化的Agent: ${persistedAgents.join(', ')}`);

    for (const ctx of allCtxRows) {
      const messages = JSON.parse(ctx.messages || '[]');
      const state = JSON.parse(ctx.state || '{}');
      const userMsgs = messages.filter(m => m.role === 'user');
      const assistantMsgs = messages.filter(m => m.role === 'assistant');
      const systemMsgs = messages.filter(m => m.role === 'system');

      log('DEEP-CTX', `\n  Agent: ${ctx.agent_type}`);
      log('DEEP-CTX', `    总消息数: ${messages.length} (system=${systemMsgs.length}, user=${userMsgs.length}, assistant=${assistantMsgs.length})`);
      log('DEEP-CTX', `    state keys: [${Object.keys(state).join(', ')}]`);

      if (userMsgs.length > 0) {
        log('DEEP-CTX', `    第一条user消息: "${(userMsgs[0].content || '').substring(0, 60)}"`);
        log('DEEP-CTX', `    最后一条user消息: "${(userMsgs[userMsgs.length - 1].content || '').substring(0, 60)}"`);
      }

      check(messages.length > 0, `${ctx.agent_type} 有消息记录 (${messages.length}条)`, 'DEEP-CTX');

      for (const msg of messages) {
        if (msg.role && !['system', 'user', 'assistant', 'tool'].includes(msg.role)) {
          check(false, `${ctx.agent_type} 消息有异常role: ${msg.role}`, 'DEEP-CTX');
        }
      }
    }

    // 检查对话Agent的上下文是否包含交易记忆
    const dialogueCtx = allCtxRows.find(c => c.agent_type === 'dialogue');
    if (dialogueCtx) {
      const dialogueMessages = JSON.parse(dialogueCtx.messages || '[]');
      const hasTradeMemory = dialogueMessages.some(m =>
        (m.content || '').includes('交易') || (m.content || '').includes('卖') || (m.content || '').includes('剑')
      );
      check(hasTradeMemory, 'dialogue Agent上下文包含交易记忆', 'DEEP-CTX');
    }

    // 检查coordinator的上下文
    const coordinatorCtx = allCtxRows.find(c => c.agent_type === 'coordinator');
    if (coordinatorCtx) {
      const coordMessages = JSON.parse(coordinatorCtx.messages || '[]');
      log('DEEP-CTX', `coordinator消息数: ${coordMessages.length}`);
      const coordUserMsgs = coordMessages.filter(m => m.role === 'user');
      check(coordUserMsgs.length > 0, `coordinator有user消息 (${coordUserMsgs.length}条)`, 'DEEP-CTX');
    }

    // ==================== STEP 15: NPC记忆验证 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 15: NPC记忆验证 — 关系/对话/态度追踪');
    console.log('═'.repeat(60));

    const finalNPCs = getNPCsFromDB();
    const finalRelations = getNPCRelationsFromDB();
    const finalDialogues = getDialoguesFromDB();

    log('NPC-MEM', `NPC数量: ${finalNPCs.length}`);
    log('NPC-MEM', `NPC关系记录数: ${finalRelations.length}`);
    log('NPC-MEM', `对话记录数: ${finalDialogues.length}`);

    for (const npc of finalNPCs) {
      log('NPC-MEM', `  ${npc.name}: role=${npc.role}, attitude=${npc.attitude}`);
      const npcDialogues = finalDialogues.filter(d => d.npc_id === npc.id || d.speaker === npc.name);
      log('NPC-MEM', `    对话数: ${npcDialogues.length}`);
      const npcRelations = finalRelations.filter(r => r.npc_id === npc.id);
      log('NPC-MEM', `    关系数: ${npcRelations.length}`);
      for (const rel of npcRelations) {
        log('NPC-MEM', `      type=${rel.relation_type}, affection=${rel.affection || 'N/A'}, trust=${rel.trust || 'N/A'}`);
      }
    }

    const merchantDialogues = finalDialogues.filter(d => d.speaker === tradeInfo.npcName || d.npc_id === merchantNpc?.id);
    check(merchantDialogues.length > 0, `商人${tradeInfo.npcName}有对话记录 (${merchantDialogues.length}条)`, 'NPC-MEM');

    // ==================== STEP 16: 决策日志验证 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 16: 决策日志验证 — Agent决策追踪');
    console.log('═'.repeat(60));

    const decisionLogs = getDecisionLogsFromDB();
    log('DECISION', `决策日志数: ${decisionLogs.length}`);
    for (const d of decisionLogs.slice(0, 10)) {
      log('DECISION', `  ${d.agent_type}: decision=${(d.decision_type || '').substring(0, 30)}, success=${d.outcome === 'success'}`);
    }

    const agentDecisions = {};
    for (const d of decisionLogs) {
      agentDecisions[d.agent_type] = (agentDecisions[d.agent_type] || 0) + 1;
    }
    log('DECISION', `各Agent决策数: ${JSON.stringify(agentDecisions)}`);

    // ==================== STEP 17: 最终数据一致性验证 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('STEP 17: 最终数据一致性验证 — 全量对比');
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

    const finalNPCs2 = getNPCsFromDB();
    check(finalNPCs2.length >= 1, `NPC数量>=1 (实际=${finalNPCs2.length})`, 'FINAL');

    const finalQuests = getQuestsFromDB();
    check(finalQuests.length >= 1, `任务数量>=1 (实际=${finalQuests.length})`, 'FINAL');

    const finalGameState = getGameStateFromDB();
    log('FINAL', `save_game_state记录数: ${finalGameState.length}`);

    const finalCtx = getAgentContextsFromDB();
    log('FINAL', `agent_contexts持久化的Agent类型: ${finalCtx.map(c => c.agent_type).join(', ')}`);

    snapshotDB('final');

    // ==================== 数据流转汇总 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('数据流转汇总 — 各阶段数据变化');
    console.log('═'.repeat(60));

    const stages = ['before_init', 'after_init', 'after_trade', 'after_mid_chat', 'after_memory', 'after_explore', 'after_combat', 'after_memory2', 'after_skill', 'after_inventory', 'after_quest', 'final'];
    for (let i = 1; i < stages.length; i++) {
      const diff = diffSnapshots(stages[i - 1], stages[i]);
      const changes = Object.entries(diff).map(([t, d]) => `${t}: ${d.before}→${d.after}`).join(', ');
      if (changes) {
        log('FLOW', `${stages[i - 1]} → ${stages[i]}: ${changes}`);
      } else {
        log('FLOW', `${stages[i - 1]} → ${stages[i]}: 无变化`);
      }
    }

    // ==================== session.log检查 ====================
    console.log('\n' + '═'.repeat(60));
    console.log('session.log 检查 — warn/error统计');
    console.log('═'.repeat(60));

    try {
      const logContent = fs.readFileSync(LOG_PATH, 'utf-8');
      const logLines = logContent.split('\n').filter(l => l.trim());
      const warnLines = logLines.filter(l => l.includes('[warn]'));
      const errorLines = logLines.filter(l => l.includes('[error]'));

      log('LOG', `总日志行数: ${logLines.length}`);
      log('LOG', `warn行数: ${warnLines.length}`);
      log('LOG', `error行数: ${errorLines.length}`);

      if (warnLines.length > 0) {
        log('LOG', '\n  === WARN 日志 ===');
        for (const w of warnLines.slice(0, 20)) {
          log('LOG-WARN', w.substring(0, 150));
        }
      }

      if (errorLines.length > 0) {
        log('LOG', '\n  === ERROR 日志 ===');
        for (const e of errorLines.slice(0, 20)) {
          log('LOG-ERROR', e.substring(0, 150));
        }
      }

      const criticalErrors = errorLines.filter(e =>
        !e.includes('combat not active') &&
        !e.includes('Failed to persist context') &&
        !e.includes('Failed to clear persisted context')
      );
      if (criticalErrors.length > 0) {
        check(false, `发现${criticalErrors.length}条关键ERROR日志`, 'LOG');
      } else {
        check(true, '无关键ERROR日志', 'LOG');
      }
    } catch (e) {
      log('LOG', `无法读取session.log: ${e.message}`);
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
      tradeInfo,
      memoryTest: {
        npcName: tradeInfo.npcName,
        firstMemoryRecall: { mentionsNpcName, mentionsTrade },
        secondMemoryRecall: { mentionsTrade2 }
      },
      dataSnapshots: Object.fromEntries(
        Object.entries(dataSnapshots).map(([k, v]) => [k, Object.fromEntries(
          Object.entries(v).map(([t, rows]) => [t, Array.isArray(rows) ? rows.length : rows])
        )])
      ),
      finalState: {
        character: finalChar ? { name: finalChar.name, race: finalChar.race, class: finalChar.class, level: finalChar.level, gold: finalChar.gold, hp: `${finalChar.health}/${finalChar.max_health}`, mp: `${finalChar.mana}/${finalChar.max_mana}` } : null,
        inventory: finalInv.length,
        skills: finalSkills.length,
        npcs: finalNPCs2.length,
        quests: finalQuests.length,
        agentContexts: finalCtx.length,
        dialogues: getDialoguesFromDB().length,
        gameState: finalGameState.length,
        npcRelations: getNPCRelationsFromDB().length,
        decisionLogs: getDecisionLogsFromDB().length
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
