import { z } from 'zod'

const pendingApprovalSchema = z.object({
  id: z.string(),
  task: z.string(),
  from: z.string(),
  to: z.string(),
  artifacts: z.string(),
  file: z.string(),
})

const clarificationSchema = z.object({
  id: z.string(),
  role: z.string(),
  question: z.string(),
  file: z.string(),
})

const countsSchema = z.object({ new: z.number(), inProcess: z.number(), completed: z.number() })
const outboxCountsSchema = z.object({ tmp: z.number(), sent: z.number(), failed: z.number() })

export const swarmQueueSnapshotSchema = z.object({
  approvals: z.array(pendingApprovalSchema),
  clarifications: z.array(clarificationSchema),
  tasks: z.array(z.object({ name: z.string(), lane: z.string(), updatedAt: z.string() })),
  boxes: z.array(z.object({
    role: z.string(), inbox: countsSchema, outbox: outboxCountsSchema,
    pendingInbox: z.array(z.string()), pendingOutbox: z.array(z.string()),
  })),
  version: z.literal(2),
}).nullable()
