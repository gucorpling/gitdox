from github import Github
from github.GithubException import UnknownObjectException


class GitHubUtility:
    def __init__(self, token, repo_name):
        """
        Initializes the GitHub connection and fetches the target repository.
        :param token: Your GitHub Personal Access Token
        :param repo_name: The repo name with optional subfolders,
                          e.g., "org/repo" or "org/repo/folder/subfolder"
        """
        self.g = Github(token)

        # Parse the repo string into the actual repo name and the base folder path
        parts = repo_name.strip("/").split("/")
        actual_repo = "/".join(parts[:2])
        self.base_path = "/".join(parts[2:]) if len(parts) > 2 else ""

        self.repo = self.g.get_repo(actual_repo)

    def _get_full_path(self, file_path):
        """
        Helper to prepend the base folder path to the filename if a subfolder was specified.
        """
        if self.base_path:
            # lstrip and rstrip ensure we don't accidentally double up on slashes
            return f"{self.base_path.rstrip('/')}/{file_path.lstrip('/')}"
        return file_path

    def push_new_version(self, file_path, new_content, commit_message):
        """
        1. Pushes a new version of a file to the repository.
        Note: The GitHub API requires the current file's SHA to update it.
        """
        full_path = self._get_full_path(file_path)

        try:
            # Update existing file.
            contents = self.repo.get_contents(full_path)
            self.repo.update_file(
                path=contents.path,
                message=commit_message,
                content=new_content,
                sha=contents.sha
            )
        except UnknownObjectException:
            # First commit for this path: create file instead of update.
            # Note: GitHub automatically creates any necessary parent folders if they don't exist.
            self.repo.create_file(
                path=full_path,
                message=commit_message,
                content=new_content
            )

        print(f"Successfully pushed new version of '{full_path}'.")

    def get_latest_commit_message(self, file_path):
        """
        2. Retrieves the most recent commit message for a specific file.
        """
        return self.get_latest_commit_info(file_path).get("message", "")

    def get_latest_commit_info(self, file_path):
        """
        Retrieves latest commit metadata for a file.
        Returns an empty payload when no commit exists for that path.
        """
        full_path = self._get_full_path(file_path)

        try:
            commits = self.repo.get_commits(path=full_path)
            for latest_commit in commits:
                return {
                    "message": latest_commit.commit.message or "",
                    "url": getattr(latest_commit, "html_url", "") or ""
                }
            return {"message": "", "url": ""}
        except UnknownObjectException:
            return {"message": "", "url": ""}

    def get_file_contents(self, file_path):
        """
        3. Retrieves the decoded contents of a specific file.
        """
        full_path = self._get_full_path(file_path)
        contents = self.repo.get_contents(full_path)

        # The content is returned as bytes and base64 encoded, so we decode it to a string
        return contents.decoded_content.decode('utf-8')


# ==========================================
# Example Usage:
# ==========================================
if __name__ == "__main__":
    TOKEN = "your_personal_access_token_here"

    # Now supports standard repos AND repos with nested base paths
    REPO = "gucorpling/gitdox_tests/my_nested/subfolder"
    FILE_PATH = "data/config.json"

    # Initialize the utility
    gh_util = GitHubUtility(TOKEN, REPO)

    # 1. Push a new version of the file (will create 'my_nested/subfolder/data/config.json')
    print("\n--- Pushing Update ---")
    new_data = '{"status": "updated", "version": "2.0"}'
    gh_util.push_new_version(FILE_PATH, new_data, "Update config.json to v2.0")

    # 2. Get the contents of the file
    print("\n--- Current Contents ---")
    print(gh_util.get_file_contents(FILE_PATH))

    # 3. Get the most recent commit message for that file
    print("\n--- Latest Commit Message ---")
    print(gh_util.get_latest_commit_message(FILE_PATH))