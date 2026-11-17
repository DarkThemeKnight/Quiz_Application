import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.describe.configure({ mode: 'serial' });

test('anonymous visitors are sent to sign-in and the API refuses data', async ({
  page,
  request,
}) => {
  await page.goto('/bank');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const res = await request.get('/api/questions');
  expect(res.status()).toBe(401);
});

test('author subject, topic, collection and all three question families, then practise them', async ({
  page,
}) => {
  await signIn(page);

  // Subjects & collections
  await page.goto('/library');
  await page.getByRole('textbox', { name: 'New subject' }).fill('E2E Biology');
  await page.getByRole('textbox', { name: 'New subject' }).press('Enter');
  await expect(page.getByRole('button', { name: /^E2E Biology \d/ })).toBeVisible();
  await page.getByRole('button', { name: /^E2E Biology \d/ }).click();
  await page.getByRole('textbox', { name: 'New topic' }).fill('Cells');
  await page.getByRole('textbox', { name: 'New topic' }).press('Enter');
  await expect(page.getByRole('link', { name: /Cells/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'New collection' }).fill('E2E Set');
  await page.getByRole('textbox', { name: 'New collection' }).press('Enter');
  await expect(page.getByRole('link', { name: 'E2E Set' })).toBeVisible();

  const chooseSubjectTopic = async () => {
    await page.getByLabel('Subject', { exact: true }).selectOption({ label: 'E2E Biology' });
    await page.getByLabel('Topic (optional)').selectOption({ label: 'Cells' });
  };

  // Single choice
  await page.goto('/bank/new');
  await chooseSubjectTopic();
  await page
    .getByLabel('Question', { exact: true })
    .fill('Which organelle produces most of a cell’s ATP?');
  await page.getByLabel('Option A text').fill('Mitochondrion');
  await page.getByLabel('Option B text').fill('Ribosome');
  await page.getByLabel('Option C text').fill('Golgi apparatus');
  await page.getByLabel('Option D text').fill('Lysosome');
  await page.getByLabel('Option A is correct').check();
  await page.getByLabel('E2E Set').check();
  await page.getByLabel(/Explanation/).fill('Mitochondria carry out cellular respiration.');
  await page.getByRole('button', { name: 'Save question' }).click();
  await expect(page.getByRole('heading', { name: 'Edit question' })).toBeVisible();

  // Validation: a true/false question without a chosen answer is rejected client-side.
  await page.goto('/bank/new');
  await page.getByLabel('True / false').check();
  await chooseSubjectTopic();
  await page.getByLabel('Statement').fill('Plant cells have no cell wall.');
  await page.getByRole('button', { name: 'Save question' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'true or false' })).toBeVisible();
  await page
    .getByRole('group', { name: 'The statement is…' })
    .getByRole('radio', { name: 'False' })
    .check();
  await page.getByRole('button', { name: 'Save question' }).click();
  await expect(page.getByRole('heading', { name: 'Edit question' })).toBeVisible();

  // Fill in the gap with aliases
  await page.goto('/bank/new');
  await page.getByLabel('Fill in the gap').check();
  await chooseSubjectTopic();
  await page.getByLabel('Question', { exact: true }).fill('The basic unit of life is the ');
  await page.getByRole('button', { name: 'Insert blank at cursor' }).click();
  await page.getByLabel('Blank 1 {{blank:1}}').fill('cell\ncells');
  await page.getByRole('button', { name: 'Save question' }).click();
  await expect(page.getByRole('heading', { name: 'Edit question' })).toBeVisible();

  // Practise the subject
  await page.goto('/practice');
  await page.getByRole('checkbox', { name: /E2E Biology/ }).check();
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page).toHaveURL(/\/session\//);

  for (let i = 0; i < 3; i++) {
    const kind = await page.locator('.pill').first().textContent();
    if (kind?.includes('Single')) {
      await page.getByRole('radio', { name: /Mitochondrion/ }).click();
    } else if (kind?.includes('True')) {
      // Checking without an answer is refused — unanswered is never "false".
      await page.getByRole('button', { name: 'Check answer' }).click();
      await expect(page.getByText('Choose an answer first.')).toBeVisible();
      await page.getByRole('radio', { name: 'False' }).click();
    } else {
      await page.getByLabel('Blank 1 of 1').fill('  CELLS ');
    }
    await page.getByRole('button', { name: 'Check answer' }).click();
    await expect(page.locator('.feedback').getByText('Correct', { exact: true })).toBeVisible();
    if (i < 2) await page.getByRole('button', { name: 'Next question' }).click();
  }
  await page.getByRole('button', { name: 'See results' }).click();
  await page.getByRole('button', { name: 'Finish and see results' }).click();
  await expect(page).toHaveURL(/\/results$/);
  await expect(page.locator('.results-score')).toHaveText('100%');
});

test('edited questions leave completed history unchanged', async ({ page }) => {
  await signIn(page);
  await page.goto('/history');
  await page
    .getByRole('link', { name: /E2E Biology/ })
    .first()
    .click();
  await expect(page.locator('.results-score')).toHaveText('100%');
  const resultUrl = page.url();

  await page.goto('/bank?q=organelle');
  await page.getByRole('link', { name: /Which organelle/ }).click();
  await page.getByLabel('Question', { exact: true }).fill('EDITED prompt about organelles?');
  await page.getByLabel('Option B is correct').check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(/\/bank$/);

  await page.goto(resultUrl);
  await expect(page.locator('.results-score')).toHaveText('100%');
  await expect(page.getByText('Which organelle produces most of a cell’s ATP?')).toBeVisible();
  await expect(page.getByText(/edited since/)).toBeVisible();
});

test('a 15-question timed exam saves answers across reload and keeps its score', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Load sample questions' }).click();
  await expect(page.getByText(/Loaded 24 sample questions/)).toBeVisible();

  await page.goto('/practice');
  await page.getByRole('radio', { name: /Mock exam/ }).check();
  await page.getByLabel('Number of questions').fill('15');
  await page.getByLabel('Time limit (minutes)').fill('20');
  await page.getByRole('button', { name: 'Start mock exam' }).click();
  await expect(page).toHaveURL(/\/session\//);
  await expect(page.getByRole('timer')).toBeVisible();

  // Answer the first five questions with the keyboard where possible.
  let answered = 0;
  for (let i = 0; i < 5; i++) {
    const kind = await page.locator('.pill').first().textContent();
    if (kind?.includes('Fill')) {
      await page.locator('.gap-input').first().fill('answer');
    } else {
      await page.keyboard.press('1');
    }
    answered++;
    await expect(page.getByText('Saved')).toBeVisible();
    await page.getByRole('button', { name: 'Save & next' }).click();
  }
  // No answer key or feedback leaks during an exam.
  await expect(page.locator('.feedback')).toHaveCount(0);

  await page.reload();
  await expect(page.getByText(`${answered} answered`)).toBeVisible();
  await expect(page.getByText('Question 6 of 15')).toBeVisible();

  await page.getByRole('button', { name: 'Submit exam' }).click();
  await expect(page.getByText(/10 questions unanswered/)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit exam' }).click();
  await expect(page).toHaveURL(/\/results$/);
  const score = await page.locator('.results-score').textContent();
  await expect(page.getByText(/of 15 questions correct/)).toBeVisible();
  await page.reload();
  await expect(page.locator('.results-score')).toHaveText(score ?? '');
  await expect(page.locator('.review-item')).toHaveCount(15);
});

test('dashboard reflects real attempts with clickable paths to practice', async ({ page }) => {
  await signIn(page);
  await page.goto('/');
  await expect(page.getByText('Practice accuracy · 30 days')).toBeVisible();
  await expect(page.getByText(/of 3 answers correct/)).toBeVisible();
  await expect(page.getByText(/Mean of 1 completed exam/)).toBeVisible();
  await expect(page.getByRole('link', { name: /E2E Biology/ }).first()).toBeVisible();
  await page.getByRole('link', { name: 'New session' }).click();
  await expect(page).toHaveURL(/\/practice/);
  await page.goto('/insights');
  await expect(page.getByRole('heading', { name: 'Learning insights' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Topic performance' })).toBeVisible();
});

test('CSV import reports bad rows and writes nothing', async ({ page }) => {
  await signIn(page);
  await page.goto('/bank/import');
  await page.getByRole('radio', { name: 'CSV' }).check();
  await page
    .getByLabel('…or paste the contents')
    .fill(
      'type,prompt,subject,correct_answers_json\ntrue_false,Good row,Imported,true\nfill_gap,Bad {{blank:1}},Imported,"{""2"":[""x""]}"\n',
    );
  await page.getByRole('button', { name: /Validate & preview/ }).click();
  await expect(page.getByText(/Fix 1 row before importing/)).toBeVisible();
  await expect(page.getByRole('button', { name: /4\. Import/ })).toBeDisabled();
  await page.goto('/bank?q=Good%20row');
  await expect(page.getByText('No questions match these filters')).toBeVisible();
});
