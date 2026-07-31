import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Progress } from '@/components/ui/Progress';
import { Badge } from '@/components/ui/Badge';
import { Tooltip } from '@/components/ui/Tooltip';

export default function ComponentShowcase() {
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLoadingClick = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] p-8">
      <div className="mx-auto max-w-5xl space-y-10">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">通用组件展示</h1>

        <section>
          <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">Button 按钮</h2>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button variant="primary">主要按钮</Button>
              <Button variant="secondary">次要按钮</Button>
              <Button variant="outline">边框按钮</Button>
              <Button variant="ghost">幽灵按钮</Button>
              <Button variant="danger">危险按钮</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">小号</Button>
              <Button size="md">中号</Button>
              <Button size="lg">大号</Button>
              <Button loading={loading} onClick={handleLoadingClick}>
                {loading ? '加载中...' : '点击加载'}
              </Button>
              <Button disabled>禁用状态</Button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">Input 输入框</h2>
          <div className="max-w-md space-y-4">
            <Input label="角色名称" placeholder="请输入角色名称" hint="2-12个字符" />
            <Input label="密码" placeholder="请输入密码" type="password" error="密码不能少于6位" />
            <Input placeholder="搜索..." icon={<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>} />
            <Input label="禁用输入框" value="不可编辑" disabled />
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">Card 卡片</h2>
          <div className="grid grid-cols-2 gap-4">
            <Card variant="default" header={<span className="font-medium text-[var(--text-primary)]">默认卡片</span>}>
              <p className="text-sm text-[var(--text-secondary)]">带边框和微阴影的默认卡片样式</p>
            </Card>
            <Card variant="bordered" header={<span className="font-medium text-[var(--text-primary)]">粗边框卡片</span>}>
              <p className="text-sm text-[var(--text-secondary)]">带粗边框的强调卡片</p>
            </Card>
            <Card variant="elevated" hoverable header={<span className="font-medium text-[var(--text-primary)]">浮起卡片</span>}>
              <p className="text-sm text-[var(--text-secondary)]">悬停时上浮，可点击</p>
            </Card>
            <Card variant="ghost" footer={<span className="text-xs text-[var(--text-muted)]">底部信息</span>}>
              <p className="text-sm text-[var(--text-secondary)]">透明背景的幽灵卡片</p>
            </Card>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">Progress 进度条</h2>
          <div className="max-w-lg space-y-4">
            <Progress value={75} max={100} variant="health" size="md" showLabel label="HP" />
            <Progress value={45} max={100} variant="mana" size="md" showLabel label="MP" />
            <Progress value={1200} max={2000} variant="experience" size="sm" showLabel label="EXP" />
            <Progress value={500} max={1000} variant="gold" size="sm" animated label="金币" />
            <Progress value={60} max={100} variant="default" size="lg" />
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">Badge 徽章</h2>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="default">默认</Badge>
              <Badge variant="primary">主要</Badge>
              <Badge variant="success">成功</Badge>
              <Badge variant="warning">警告</Badge>
              <Badge variant="error">错误</Badge>
              <Badge variant="info">信息</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge rarity="common" dot>普通</Badge>
              <Badge rarity="uncommon" dot>优秀</Badge>
              <Badge rarity="rare" dot>稀有</Badge>
              <Badge rarity="epic" dot>史诗</Badge>
              <Badge rarity="legendary" dot>传说</Badge>
              <Badge rarity="unique" dot>独特</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge rarity="common" size="md">普通物品</Badge>
              <Badge rarity="epic" size="md">史诗物品</Badge>
              <Badge rarity="legendary" size="md">传说物品</Badge>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">Tooltip 工具提示</h2>
          <div className="flex flex-wrap gap-6">
            <Tooltip content="上方提示" position="top">
              <Button variant="outline">上方</Button>
            </Tooltip>
            <Tooltip content="下方提示" position="bottom">
              <Button variant="outline">下方</Button>
            </Tooltip>
            <Tooltip content="左侧提示" position="left">
              <Button variant="outline">左侧</Button>
            </Tooltip>
            <Tooltip content="右侧提示" position="right">
              <Button variant="outline">右侧</Button>
            </Tooltip>
            <Tooltip content="攻击力 +10&#10;暴击率 +5%" position="top">
              <Badge rarity="rare" dot size="md">稀有武器</Badge>
            </Tooltip>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">Modal 模态框</h2>
          <div className="flex gap-3">
            <Button onClick={() => setModalOpen(true)}>打开模态框</Button>
          </div>
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="确认操作"
            description="此操作将永久删除该存档"
            size="sm"
            footer={
              <>
                <Button variant="secondary" onClick={() => setModalOpen(false)}>取消</Button>
                <Button variant="danger" onClick={() => setModalOpen(false)}>确认删除</Button>
              </>
            }
          >
            <p className="text-sm text-[var(--text-secondary)]">删除后无法恢复，请确认是否继续？</p>
          </Modal>
        </section>
      </div>
    </div>
  );
}
