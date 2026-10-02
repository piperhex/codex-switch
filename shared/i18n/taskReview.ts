const messages: Record<string, [string, string]> = {
  "任务验收": [
    "Task review",
    "Проверка результата",
  ],
  "验收结果": [
    "Review result",
    "Проверить результат",
  ],
  "查看本轮改动，验证后再决定是否交付。": [
    "Review the changes and verify them before delivery.",
    "Проверьте изменения перед передачей результата.",
  ],
  "{value1} 个改动文件": [
    "{value1} changed files",
    "Изменено файлов: {value1}",
  ],
  "项目验证": [
    "Project checks",
    "Проверки проекта",
  ],
  "代码版本": [
    "Code version",
    "Версия кода",
  ],
  "尚未提交": [
    "No commit yet",
    "Ещё нет коммита",
  ],
  "验证当前项目代码；聊天中提到的测试结果不会自动记为通过。": [
    "Checks run against the current project. Claims in chat do not count as verified results.",
    "Проверяется текущий код проекта. Сообщения в чате не считаются подтверждёнными результатами.",
  ],
  "未运行": [
    "Not run",
    "Не запускалось",
  ],
  "运行中": [
    "Running",
    "Выполняется",
  ],
  "通过": [
    "Passed",
    "Пройдено",
  ],
  "失败": [
    "Failed",
    "Ошибка",
  ],
  "结果已过期": [
    "Result is out of date",
    "Результат устарел",
  ],
  "验证已中断": [
    "Check interrupted",
    "Проверка прервана",
  ],
  "运行验证": [
    "Run check",
    "Запустить проверку",
  ],
  "项目未配置这项验证。": [
    "This check is not configured for the project.",
    "Эта проверка не настроена в проекте.",
  ],
  "查看验证记录": [
    "View check record",
    "Открыть запись проверки",
  ],
  "收起验证记录": [
    "Hide check record",
    "Скрыть запись проверки",
  ],
  "等待验证完成。": [
    "Waiting for the check to finish.",
    "Ожидание завершения проверки.",
  ],
  "确认运行验证": [
    "Confirm check",
    "Подтвердить запуск",
  ],
  "将在电脑上运行项目命令，可能修改文件或下载依赖。": [
    "This runs a project command on your computer and may change files or download dependencies.",
    "Команда запустится на компьютере и может изменить файлы или загрузить зависимости.",
  ],
  "PR 与 CI": [
    "PR and CI",
    "PR и CI",
  ],
  "刷新 PR 与 CI": [
    "Refresh PR and CI",
    "Обновить PR и CI",
  ],
  "PR 提交": [
    "PR commit",
    "Коммит PR",
  ],
  "CI 对应其他代码版本，请提交并推送当前改动后再确认。": [
    "CI refers to a different code version. Commit and push your current changes before confirming.",
    "CI относится к другой версии кода. Сначала закоммитьте и отправьте текущие изменения.",
  ],
  "暂无 CI 结果。": [
    "No CI results yet.",
    "Результатов CI пока нет.",
  ],
  "当前分支还没有打开的 PR。": [
    "There is no open PR for this branch.",
    "Для этой ветки нет открытого PR.",
  ],
  "创建草稿 PR": [
    "Create draft PR",
    "Создать черновик PR",
  ],
  "确认创建草稿 PR": [
    "Confirm draft PR",
    "Подтвердить создание PR",
  ],
  "请先通过 Git 入口提交并推送当前改动，再创建 PR。": [
    "Commit and push your changes from Git before creating a PR.",
    "Сначала закоммитьте и отправьте изменения через Git, затем создайте PR.",
  ],
  "PR 标题": [
    "PR title",
    "Заголовок PR",
  ],
  "PR 说明": [
    "PR description",
    "Описание PR",
  ],
  "目标分支（留空使用默认分支）": [
    "Base branch (leave blank for default)",
    "Целевая ветка (по умолчанию, если не указана)",
  ],
  "恢复本轮修改": [
    "Restore this turn’s changes",
    "Отменить изменения этого хода",
  ],
  "恢复前检查新改动，发现冲突时不会覆盖文件。": [
    "New changes are checked first. Conflicting files will not be overwritten.",
    "Новые изменения проверяются заранее. При конфликте файлы не перезаписываются.",
  ],
  "本轮修改已恢复。": [
    "This turn’s changes have been restored.",
    "Изменения этого хода отменены.",
  ],
  "预览恢复影响": [
    "Preview restore",
    "Предпросмотр отмены",
  ],
  "确认恢复本轮修改": [
    "Confirm restore",
    "Подтвердить отмену",
  ],
  "文件已有其他修改，无法安全恢复。请先审核差异。": [
    "Files contain other changes and cannot be restored safely. Review the diff first.",
    "В файлах есть другие изменения. Для безопасной отмены сначала проверьте различия.",
  ],
  "预览未发现冲突，恢复时会再次检查。": [
    "No conflicts found in the preview. Files will be checked again before restoring.",
    "Конфликтов не обнаружено. Перед отменой файлы будут проверены повторно.",
  ],
  "连接电脑后可验证、提交意见和恢复修改。": [
    "Connect to your computer to run checks, send feedback or restore changes.",
    "Подключитесь к компьютеру, чтобы запустить проверки, отправить отзыв или отменить изменения.",
  ],
  "刷新验收结果": [
    "Refresh review",
    "Обновить результаты",
  ],
  "本轮改动": [
    "This turn’s changes",
    "Изменения этого хода",
  ],
  "点击改动行旁的留言按钮，让原会话继续修改。": [
    "Leave feedback beside a changed line to continue fixing it in the original conversation.",
    "Оставьте отзыв у изменённой строки, чтобы продолжить исправление в исходном чате.",
  ],
  "意见已发送到原会话。": [
    "Feedback sent to the original conversation.",
    "Отзыв отправлен в исходный чат.",
  ],
  "修改意见": [
    "Review feedback",
    "Замечание к коду",
  ],
  "这行需要如何修改？": [
    "How should this line change?",
    "Как изменить эту строку?",
  ],
  "发送到原会话": [
    "Send to original chat",
    "Отправить в исходный чат",
  ],
  "对第 {value1} 行留言": [
    "Comment on line {value1}",
    "Комментарий к строке {value1}",
  ],
  "留言": [
    "Comment",
    "Комментировать",
  ],
  "尚未确认意见已发送，请先检查原会话。": [
    "Delivery is unconfirmed. Check the original chat before sending again.",
    "Доставка не подтверждена. Проверьте исходный чат перед повторной отправкой.",
  ],
  "无法打开链接，请稍后重试。": [
    "Could not open the link. Try again.",
    "Не удалось открыть ссылку. Повторите попытку.",
  ],
  "无法读取 GitHub 状态，请在电脑上安装并登录 GitHub CLI，再检查网络和仓库权限。": [
    "Could not read GitHub status. Install and sign in to GitHub CLI on the computer, then check the network " +
    "and repository access.",
    "Не удалось получить статус GitHub. Установите GitHub CLI на компьютере, войдите в аккаунт и проверьте " +
    "сеть и доступ к репозиторию.",
  ],
  "代码已变化，请刷新验收结果后再试。": [
    "The code has changed. Refresh the review and try again.",
    "Код изменился. Обновите результаты и повторите попытку.",
  ],
  "请先预览恢复影响，再确认恢复。": [
    "Preview the restore before confirming it.",
    "Сначала откройте предпросмотр отмены.",
  ],
  "无法保存验证记录，请检查电脑可用空间后重试。": [
    "Could not save the check. Check free space on the computer and try again.",
    "Не удалось сохранить проверку. Проверьте свободное место на компьютере и повторите попытку.",
  ],
  "项目已有验证在运行，请等待完成。": [
    "A project check is already running. Wait for it to finish.",
    "Проверка проекта уже выполняется. Дождитесь завершения.",
  ],
  "项目未配置这项验证，请先在电脑上配置。": [
    "This check is not configured. Set it up on your computer first.",
    "Эта проверка не настроена. Сначала настройте её на компьютере.",
  ],
  "未跟踪文件过大或包含链接，暂时无法核实代码版本。请先在电脑上整理文件。": [
    "Untracked files are too large or include links. Organize them on the computer before verifying the code " +
    "version.",
    "Неотслеживаемые файлы слишком велики или содержат ссылки. Сначала разберите их на компьютере.",
  ],
  "项目包含子模块，暂时无法完整核实验证版本，请在电脑上验证。": [
    "This project contains submodules. Verify it on the computer because its full code version cannot be " +
    "confirmed here.",
    "В проекте есть подмодули. Проверьте его на компьютере: полную версию кода здесь подтвердить нельзя.",
  ],
  "项目有跳过检查的文件，暂时无法核实代码版本。请先在电脑上恢复这些文件的正常跟踪。": [
    "Some project files skip change detection. Restore normal tracking on the computer before verifying the " +
    "code version.",
    "Некоторые файлы исключены из проверки изменений. Восстановите их обычное отслеживание на компьютере.",
  ],
  "请填写 PR 标题，并缩短过长的说明。": [
    "Enter a PR title and shorten any overly long description.",
    "Укажите заголовок PR и сократите слишком длинное описание.",
  ],
  "PR 创建结果尚未确认，请刷新 PR 状态；若未创建，请检查分支是否已推送。": [
    "PR creation is unconfirmed. Refresh its status; if it was not created, check that the branch has been " +
    "pushed.",
    "Создание PR не подтверждено. Обновите статус; если PR нет, проверьте, отправлена ли ветка.",
  ],
};

export const reviewEnglish = Object.fromEntries(Object.entries(messages).map(([key, values]) => [key, values[0]]));
export const reviewRussian = Object.fromEntries(Object.entries(messages).map(([key, values]) => [key, values[1]]));
