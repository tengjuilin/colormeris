// The Grid card's Detect rows and columns button. Size detection needs cell borders, which dot plots lack, so
// it is off for them.
import { Btn } from '../../../ui/index.ts';
import { useWorkspace } from '../../react/use-workspace.ts';

export function DetectButton({ hidden }: { hidden: boolean }) {
  const { w } = useWorkspace({ section: 'sec-grid' });
  const g = w.activePanel().grid;
  // As before, only the heatmap tool turns it off for dots.
  const dots = w.tool().kind === 'heatmap' && g.anchor === 'centers';
  return (
    <Btn
      block
      id="grid-detect"
      icon="detect"
      hidden={hidden}
      disabled={!g.corners || dots}
      title={
        dots
          ? 'Type rows and columns: detection needs cell borders, which dot plots lack'
          : 'Guess rows and columns from the image inside the grid'
      }
      onClick={() => w.commit((p) => w.applyDetectedSize(p))}
    >
      Detect rows and columns
    </Btn>
  );
}
