import { test, expect } from '@playwright/test';

test('Página de Login deve carregar com sucesso', async ({ page }) => {
    await page.goto('/');

    // Verifica o título principal na tela de login
    await expect(page.locator('h1')).toContainText('Contagem Cíclica');

    // Verifica se existem os campos de login e senha
    await expect(page.locator('input[placeholder="Seu login"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Sua senha"]')).toBeVisible();

    // Verifica o botão de entrar
    await expect(page.locator('button:has-text("Entrar")')).toBeEnabled();
});

test('Deve ser possível preencher campos de login', async ({ page }) => {
    await page.goto('/');

    await page.fill('input[placeholder="Seu login"]', 'admin');
    await page.fill('input[placeholder="Sua senha"]', 'admin123');

    await expect(page.locator('input[placeholder="Seu login"]')).toHaveValue('admin');
});
