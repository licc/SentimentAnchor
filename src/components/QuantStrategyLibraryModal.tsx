import { Modal } from './Modals'
import { StrategyLibrary } from './StrategyLibrary'

export function QuantStrategyLibraryModal({ onClose, onToast }: { onClose: () => void; onToast: (message: string, tone?: 'up' | 'down') => void }) {
  return (
    <Modal title="量化策略库" subtitle="T+1 独立策略模型 · 文字定义 / AI 生成 / 回测 / 启用" onClose={onClose} width={1180}>
      <div className="quant-strategy-modal">
        <StrategyLibrary onToast={onToast} />
      </div>
    </Modal>
  )
}
