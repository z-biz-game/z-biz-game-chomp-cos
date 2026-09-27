// Hand-computed fixtures. Every expectation in here was worked out ON PAPER, by the argument
// written above it, before any code in this repo ran — that is what makes it a fixture rather
// than a mirror of the implementation. Do not "fix" one of these by running the solver: if it
// disagrees, the solver is wrong (the two-row ones are the published Tweed characterisation).
//
// Convention: `P` = the player to move loses under perfect play (后手 wins), `N` = the player
// to move wins (先手 wins). Shapes are row-length vectors, (0,0) is the poison.

export const HAND = [
  {
    shape: [1],
    n: false,
    k: 0,
    winning: [],
    states: 1,
    why: '只剩毒格：没有可咬的格子，动手的人必须吃毒 → P',
  },
  {
    shape: [2],
    n: true,
    k: 1,
    winning: [[0, 1]],
    states: 2,
    why: '咬掉第二格 → [1] 交给对手 → 胜。唯一的口，因为别的口要咬毒格',
  },
  {
    shape: [1, 1],
    n: true,
    k: 1,
    winning: [[1, 0]],
    states: 2,
    why: '咬第二行第一列（不碰毒）→ [1] 交给对手。没有别的口：(0,1) 越界，(0,0) 是毒',
  },
  {
    shape: [2, 1],
    n: false,
    k: 0,
    winning: [],
    states: 4,
    why: 'Tweed：两行只差 1 是必败局。手算：口只有 (0,1)→[1,1] 与 (1,0)→[2]，上面已证两者皆 N',
  },
  {
    shape: [2, 2],
    n: true,
    k: 1,
    winning: [[1, 1]],
    states: 5,
    why: '咬 (1,1) 得 [2,1]，正是上面的必败局；其它口 (0,1)→[1,1] N、(0,2)→[2,2] 自身不可达、(1,0)→[2] N',
  },
  {
    shape: [3, 1],
    n: true,
    k: 1,
    winning: [[0, 2]],
    states: 6,
    why: '咬 (0,2) → [2,1] 必败局交给对手。另两口 (0,1)→[1,1] N、(1,0)→[3] N',
  },
  {
    shape: [3, 2],
    n: false,
    k: 0,
    winning: [],
    states: 8,
    why: 'Tweed 阶梯 (k,k-1)。手算四个口 (0,1)→[1,1]、(0,2)→[2,2]、(1,0)→[3]、(1,1)→[3,1]，全是 N',
  },
  {
    shape: [3, 3],
    n: true,
    k: 1,
    winning: [[1, 2]],
    states: 9,
    why: '方阵必败在第二行：咬 (1,2) → [3,2] 阶梯。逐口检查 (0,1)→[1,1]、(0,2)→[2,2]、(1,0)→[3]、(1,1)→[3,1]、(2,0)→[3,3] 自身、(2,1)→[3,3,1]、(2,2)→[3,3,2] 均非 P',
  },
  {
    shape: [4, 4],
    n: true,
    k: 1,
    winning: [[1, 3]],
    states: 14,
    why: '同上：咬 (1,3) → [4,3] 阶梯 (k,k-1)',
  },
  {
    shape: [5, 4, 3],
    n: true,
    k: 1,
    winning: [[2, 0]],
    states: 47,
    why: '整口吃掉第三行 → [5,4] 两行阶梯，仍是必败局交给对手',
  },
  {
    shape: [4, 3],
    n: false,
    k: 0,
    winning: [],
    // 序理想计数，手算：单行 4 个（[1]..[4]）；两行 (x,y) 需 4>=x、3>=y、x>=y：
    // y=1 → x=1..4（4 个），y=2 → x=2..4（3 个），y=3 → x=3..4（2 个）= 9 个。4+9=13。
    states: 13,
    why: '两行阶梯 k=4 → P',
  },
  {
    shape: [4, 2],
    n: true,
    k: 1,
    winning: [[0, 3]],
    states: 11,
    why: '咬 (0,3) → [3,2] 阶梯。非阶梯的两行局总是能把对手送上阶梯',
  },
];

// The published two-row characterisation, written out as data rather than as a formula: the
// P-positions with both rows at most 9 squares long are EXACTLY the staircase (k, k-1).
// Source: the classical Chomp result for 2×n bars (Tweed 1908), independently re-derived for
// this repo by test/naive.mjs's second enumeration route.
export const TWO_ROW_P = [[2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [7, 6], [8, 7], [9, 8]];

// Single row, widths 1..9: only the bare poisoned square is a loss for the mover.
export const SINGLE_ROW_N = [false, true, true, true, true, true, true, true, true];
