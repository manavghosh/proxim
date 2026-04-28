import { z } from 'zod'

export const RoleSchema = z.object({
  title: z.string(),
  company: z.string(),
  dates: z.string(),
  bullets: z.array(z.string()).default([]),
})

export const ParsedProfileSchema = z.object({
  name: z.string().default(''),
  contact: z.record(z.string(), z.string()).default({}),
  summary: z.string().default(''),
  roles: z.array(RoleSchema).default([]),
  skills: z.array(z.string()).default([]),
  patents: z.array(z.string()).default([]),
  projects: z.array(z.string()).default([]),
  education: z.array(z.string()).default([]),
  certifications: z.array(z.string()).default([]),
  awards: z.array(z.string()).default([]),
})

export type ParsedProfile = z.infer<typeof ParsedProfileSchema>
