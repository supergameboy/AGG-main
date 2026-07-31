const BASE_URL = 'http://localhost:17334/api/v1';

async function request(method, path, body = null, headers = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return res.json();
}

function log(title, data) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(60));
  if (typeof data === 'object') {
    console.log(JSON.stringify(data, null, 2).substring(0, 3000));
  } else {
    console.log(String(data).substring(0, 3000));
  }
}

function check(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
  } else {
    console.log(`  ❌ ${msg}`);
  }
}

async function main() {
  console.log('\n🧪 ReAct Agent 端到端测试');
  console.log('='.repeat(60));

  // ===== Step 1: 验证 Config API =====
  log('Step 1: 验证 Config API', '');
  
  const profiles = await request('GET', '/config/agent-profiles');
  check(profiles.success, 'Config API 可访问');
  check(profiles.data && profiles.data.length > 0, `Agent Profiles 加载成功 (${profiles.data?.length} 个)`);
  
  const fantasyProfile = await request('GET', '/config/agent-profiles/fantasy_rpg');
  check(fantasyProfile.success, 'fantasy_rpg 配置集存在');
  check(fantasyProfile.data?.agents, `配置集包含 ${Object.keys(fantasyProfile.data?.agents || {}).length} 个 Agent`);

  const agentsList = await request('GET', '/config/agent-profiles/fantasy_rpg/agents');
  check(agentsList.success, `Agent 列表: ${agentsList.data?.join(', ')}`);

  // ===== Step 2: 创建存档并初始化游戏 =====
  log('Step 2: 初始化游戏', '');
  
  const saveId = `test-react-${Date.now()}`;
  const characterData = {
    name: '艾琳',
    race: 'elf',
    classType: 'mage',
    background: 'scholar',
    attributes: { strength: 8, agility: 12, intelligence: 16, vitality: 10, luck: 8 }
  };

  console.log(`  存档ID: ${saveId}`);
  console.log(`  角色: ${characterData.name} (${characterData.race} ${characterData.classType})`);

  const initResult = await request('POST', '/agent/chat', {
    message: 'initialize game',
    action: 'initialize',
    saveId,
    data: { templateId: 'fantasy_rpg', characterData }
  }, { 'x-save-id': saveId });

  check(initResult.success, '游戏初始化成功');
  check(initResult.data?.data?.saveId, `存档创建: ${initResult.data?.data?.saveId}`);
  
  const actualSaveId = initResult.data?.data?.saveId || saveId;
  console.log(`  实际存档ID: ${actualSaveId}`);

  if (!initResult.success) {
    console.log('  ⚠️ 初始化失败，尝试使用原始saveId继续测试');
  }

  // ===== Step 3: 测试 ReAct 循环 - 地图探索 =====
  log('Step 3: 测试 ReAct 循环 - 地图探索', '');
  
  const exploreResult = await request('POST', '/config/react-test', {
    profileName: 'fantasy_rpg',
    agentKey: 'map',
    saveId: actualSaveId,
    playerInput: 'Show me my current location and available maps'
  });

  check(exploreResult.success, 'ReAct 循环执行完成');
  check(exploreResult.data?.success, 'ReAct Agent 返回成功');
  check(exploreResult.data?.data?._meta?.iterations > 0, `迭代次数: ${exploreResult.data?.data?._meta?.iterations}`);
  
  const mapMessage = exploreResult.data?.data?.message || '';
  check(mapMessage.length > 0, `MapAgent 回复长度: ${mapMessage.length} 字符`);
  console.log(`  回复预览: ${mapMessage.substring(0, 200)}...`);

  // ===== Step 4: 测试 ReAct 循环 - 物品管理 =====
  log('Step 4: 测试 ReAct 循环 - 物品管理', '');
  
  const inventoryResult = await request('POST', '/config/react-test', {
    profileName: 'fantasy_rpg',
    agentKey: 'inventory',
    saveId: actualSaveId,
    playerInput: 'Show me my inventory'
  });

  check(inventoryResult.success, 'InventoryAgent ReAct 循环执行完成');
  check(inventoryResult.data?.success, 'InventoryAgent 返回成功');
  
  const invMessage = inventoryResult.data?.data?.message || '';
  check(invMessage.length > 0, `InventoryAgent 回复长度: ${invMessage.length} 字符`);
  console.log(`  回复预览: ${invMessage.substring(0, 200)}...`);

  // ===== Step 5: 测试完整 GameMasterAgent 链路 =====
  log('Step 5: 测试完整 GameMasterAgent 链路', '');
  
  const chatResult = await request('POST', '/agent/chat', {
    message: 'I want to explore the area around me',
    action: 'explore',
    saveId: actualSaveId,
    data: { saveId: actualSaveId }
  }, { 'x-save-id': actualSaveId });

  check(chatResult.success, 'GameMasterAgent 链路执行完成');
  
  if (chatResult.data?.data) {
    const agentTypes = Object.keys(chatResult.data.data).filter(k => 
      !['messages', 'metadata', 'success'].includes(k)
    );
    check(agentTypes.length > 0, `参与响应的 Agent: ${agentTypes.join(', ')}`);
    
    for (const agentType of agentTypes) {
      const agentData = chatResult.data.data[agentType];
      const hasMessage = agentData?.message && agentData.message.length > 0;
      const hasDsml = agentData?.message?.includes?.('DSML') || agentData?.message?.includes?.('<|');
      check(hasMessage, `${agentType}: 回复长度 ${agentData?.message?.length || 0}`);
      if (hasDsml) {
        check(false, `${agentType}: ⚠️ 包含 DSML/特殊标记，可能 max_iterations 不够`);
      }
    }
  }

  // ===== Step 6: 测试 Config 热更新 API =====
  log('Step 6: 测试 Config 热更新 API', '');
  
  const reloadResult = await request('POST', '/config/config/reload', {
    profileName: 'fantasy_rpg'
  });
  check(reloadResult.success, '配置热更新成功');
  check(reloadResult.data?.agentCount > 0, `重载后 Agent 数量: ${reloadResult.data?.agentCount}`);

  // ===== 测试总结 =====
  log('测试总结', '');
  console.log('  所有测试步骤执行完毕');
  console.log('  详细结果请查看上方各步骤的 ✅/❌ 标记');
}

main().catch(err => {
  console.error('测试脚本执行失败:', err);
  process.exit(1);
});
