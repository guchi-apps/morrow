-- CreateTable
CREATE TABLE `MailFlowRecord` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(320) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `summary` VARCHAR(300) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `contentKey` VARCHAR(40) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MailFlowRecord_userId_messageId_idx`(`userId`, `messageId`),
    UNIQUE INDEX `MailFlowRecord_userId_messageId_kind_contentKey_key`(`userId`, `messageId`, `kind`, `contentKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MailFlowRecord` ADD CONSTRAINT `MailFlowRecord_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
