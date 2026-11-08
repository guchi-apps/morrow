-- AlterTable
ALTER TABLE `User` ADD COLUMN `mailCheckedAt` DATETIME(3) NULL,
    ADD COLUMN `mailCriteria` VARCHAR(600) NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE `MailTriage` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(320) NOT NULL,
    `needed` BOOLEAN NOT NULL,
    `reason` VARCHAR(200) NOT NULL DEFAULT '',
    `notifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MailTriage_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `MailTriage_userId_messageId_key`(`userId`, `messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MailTriage` ADD CONSTRAINT `MailTriage_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

