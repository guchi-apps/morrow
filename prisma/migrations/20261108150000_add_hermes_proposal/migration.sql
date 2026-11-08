-- CreateTable
CREATE TABLE `HermesProposal` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(128) NOT NULL,
    `callId` VARCHAR(128) NOT NULL,
    `tool` VARCHAR(64) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `expiresAt` DATETIME(3) NOT NULL,
    `idempotencyKey` VARCHAR(80) NOT NULL,
    `outcome` VARCHAR(32) NULL,
    `targetId` VARCHAR(191) NULL,
    `args` JSON NULL,
    `reportedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `HermesProposal_userId_status_idx`(`userId`, `status`),
    INDEX `HermesProposal_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `HermesProposal_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `HermesProposal_userId_sessionId_callId_key`(`userId`, `sessionId`, `callId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HermesActionLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(128) NOT NULL,
    `tool` VARCHAR(64) NOT NULL,
    `ok` BOOLEAN NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `HermesActionLog_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `HermesActionLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `HermesProposal` ADD CONSTRAINT `HermesProposal_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HermesActionLog` ADD CONSTRAINT `HermesActionLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

