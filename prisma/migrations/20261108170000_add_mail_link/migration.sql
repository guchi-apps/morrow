-- CreateTable
CREATE TABLE `MailLink` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(320) NOT NULL,
    `kind` VARCHAR(10) NOT NULL,
    `targetId` VARCHAR(120) NOT NULL,
    `calendarId` VARCHAR(200) NULL,
    `title` VARCHAR(200) NOT NULL,
    `dateText` VARCHAR(10) NULL,
    `source` VARCHAR(10) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MailLink_userId_messageId_idx`(`userId`, `messageId`),
    INDEX `MailLink_userId_kind_targetId_idx`(`userId`, `kind`, `targetId`),
    UNIQUE INDEX `MailLink_userId_messageId_kind_targetId_key`(`userId`, `messageId`, `kind`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MailLink` ADD CONSTRAINT `MailLink_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
