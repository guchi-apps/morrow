-- AlterTable
ALTER TABLE `McpConnection` ADD COLUMN `pendingAuthorizationEndpoint` VARCHAR(500) NULL,
    ADD COLUMN `pendingClientId` VARCHAR(255) NULL,
    ADD COLUMN `pendingClientSecret` TEXT NULL,
    ADD COLUMN `pendingTokenEndpoint` VARCHAR(500) NULL;
