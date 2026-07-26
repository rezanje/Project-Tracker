import { expect, test } from 'vitest'
import { groupBy, byProject, byWorkspace, type Task } from './my-tasks'

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: over.id,
    boardId: 'b1',
    boardTitle: 'Board One',
    colTitle: 'Backlog',
    workspaceId: 'w1',
    workspaceName: 'Workspace One',
    due: null,
    ...over,
  }
}

test('byProject groups tasks under their board title', () => {
  const groups = groupBy(
    [
      task({ id: 'a', boardId: 'b1', boardTitle: 'Alpha', due: '2026-07-01' }),
      task({ id: 'b', boardId: 'b2', boardTitle: 'Beta', due: '2026-07-02' }),
      task({ id: 'c', boardId: 'b1', boardTitle: 'Alpha', due: '2026-07-03' }),
    ],
    byProject,
  )
  expect(groups.map((g) => g.label)).toEqual(['Alpha', 'Beta'])
  expect(groups[0].tasks.map((t) => t.id)).toEqual(['a', 'c'])
  expect(groups[1].tasks.map((t) => t.id)).toEqual(['b'])
})

test('byWorkspace groups tasks under their workspace name', () => {
  const groups = groupBy(
    [
      task({ id: 'a', workspaceId: 'w1', workspaceName: 'Gentanala', due: '2026-07-01' }),
      task({ id: 'b', workspaceId: 'w2', workspaceName: 'GenDev', due: '2026-07-02' }),
      task({ id: 'c', workspaceId: 'w1', workspaceName: 'Gentanala', due: '2026-07-05' }),
    ],
    byWorkspace,
  )
  expect(groups.map((g) => g.label)).toEqual(['Gentanala', 'GenDev'])
  expect(groups[0].tasks.map((t) => t.id)).toEqual(['a', 'c'])
})

test('standalone tasks collapse into one Personal group in both modes', () => {
  const standalone = [
    task({ id: 's1', boardId: null, boardTitle: 'Personal', workspaceId: null, workspaceName: 'Personal', due: '2026-07-01' }),
    task({ id: 's2', boardId: null, boardTitle: 'Personal', workspaceId: null, workspaceName: 'Personal', due: '2026-07-02' }),
  ]
  for (const pick of [byProject, byWorkspace]) {
    const groups = groupBy(standalone, pick)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Personal')
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['s1', 's2'])
  }
})

test('two boards sharing a title stay separate groups (keyed by id)', () => {
  const groups = groupBy(
    [
      task({ id: 'a', boardId: 'b1', boardTitle: 'Website', due: '2026-07-01' }),
      task({ id: 'b', boardId: 'b2', boardTitle: 'Website', due: '2026-07-02' }),
    ],
    byProject,
  )
  expect(groups).toHaveLength(2)
  expect(groups.every((g) => g.label === 'Website')).toBe(true)
})

test('tasks sort by due date ascending with undated last', () => {
  const groups = groupBy(
    [
      task({ id: 'none', due: null }),
      task({ id: 'late', due: '2026-07-20' }),
      task({ id: 'early', due: '2026-07-02' }),
    ],
    byProject,
  )
  expect(groups[0].tasks.map((t) => t.id)).toEqual(['early', 'late', 'none'])
})

test('groups sort by earliest due date, undated groups last', () => {
  const groups = groupBy(
    [
      task({ id: 'a', boardId: 'b1', boardTitle: 'Later', due: '2026-07-20' }),
      task({ id: 'b', boardId: 'b2', boardTitle: 'Undated', due: null }),
      task({ id: 'c', boardId: 'b3', boardTitle: 'Urgent', due: '2026-07-01' }),
    ],
    byProject,
  )
  expect(groups.map((g) => g.label)).toEqual(['Urgent', 'Later', 'Undated'])
})

test('groups with the same earliest due date tie-break alphabetically', () => {
  const groups = groupBy(
    [
      task({ id: 'a', boardId: 'b1', boardTitle: 'Zebra', due: '2026-07-01' }),
      task({ id: 'b', boardId: 'b2', boardTitle: 'Apple', due: '2026-07-01' }),
    ],
    byProject,
  )
  expect(groups.map((g) => g.label)).toEqual(['Apple', 'Zebra'])
})

test('a board with no workspace surfaces as No workspace', () => {
  const groups = groupBy(
    [task({ id: 'a', workspaceId: null, workspaceName: 'No workspace', due: '2026-07-01' })],
    byWorkspace,
  )
  expect(groups[0].label).toBe('No workspace')
})

test('every group gets a non-empty tint', () => {
  const groups = groupBy([task({ id: 'a', due: '2026-07-01' })], byProject)
  expect(groups[0].tint).toBeTruthy()
})
