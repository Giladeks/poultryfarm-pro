// types/index.js — Shared JSDoc type definitions for IDE autocompletion

/**
 * @typedef {'LAYER'|'BROILER'|'BREEDER'|'TURKEY'} BirdType
 * @typedef {'ACTIVE'|'HARVESTED'|'CULLED'|'SOLD'} FlockStatus
 * @typedef {'SCHEDULED'|'COMPLETED'|'OVERDUE'|'MISSED'} VaccinationStatus
 * @typedef {'PENDING'|'IN_PROGRESS'|'COMPLETED'|'OVERDUE'|'CANCELLED'} TaskStatus
 * @typedef {'FEEDING'|'EGG_COLLECTION'|'VACCINATION'|'CLEANING'|'MEDICATION'|'INSPECTION'|'MORTALITY_CHECK'} TaskType
 * @typedef {'PEN_WORKER'|'PEN_MANAGER'|'FARM_MANAGER'|'FARM_OWNER'|'SUPER_ADMIN'} UserRole
 * @typedef {'ACTIVE'|'SUSPENDED'|'TRIAL'|'CANCELLED'} TenantStatus
 * @typedef {'MONTHLY'|'ANNUAL'} BillingCycle
 */

/**
 * @typedef {Object} AuthUser
 * @property {string} id
 * @property {string} email
 * @property {string} firstName
 * @property {string} lastName
 * @property {UserRole} role
 * @property {string} tenantId
 * @property {string} farmName
 * @property {string} subdomain
 * @property {string|null} penSectionId
 * @property {string} plan
 */

/**
 * @typedef {Object} Flock
 * @property {string} id
 * @property {string} batchCode
 * @property {BirdType} birdType
 * @property {string} breed
 * @property {string} penSectionId
 * @property {number} initialCount
 * @property {number} currentCount
 * @property {FlockStatus} status
 * @property {Date} dateOfPlacement
 * @property {Date|null} expectedHarvestDate
 * @property {number|null} targetWeightG
 */

/**
 * @typedef {Object} DashboardKpis
 * @property {number} totalBirds
 * @property {number} totalCapacity
 * @property {number} occupancyPct
 * @property {number} todayMortality
 * @property {number} mortalityRate
 * @property {number} mortalityTrend
 * @property {number} todayEggs
 * @property {number} todayGradeA
 * @property {number} eggsTrend
 * @property {number} feedDaysRemaining
 * @property {number} activeAlerts
 */

/**
 * @typedef {Object} Alert
 * @property {string} id
 * @property {'red'|'amber'|'blue'|'green'} severity
 * @property {'feed'|'health'|'tasks'|'mortality'|'system'} category
 * @property {string} message
 * @property {string} actionUrl
 * @property {Date} createdAt
 */

module.exports = {};
