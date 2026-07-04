import { type FormEvent, useMemo, useState } from "react";
import { APIClientError } from "../../client";
import PageHeader, {
  ErrorAlert,
  LoadingBlock,
} from "../../components/ui/page-header";
import { useToast } from "../../components/ui/toast";
import UsersTable from "../../components/users/users-table";
import {
  useCreateUser,
  useDeleteUser,
  useMe,
  useUpdateUserRole,
  useUsers,
} from "../../hooks/queries";
import type { AdminRole, AdminUserRecord } from "../../types";

const ROLES: AdminRole[] = ["viewer", "editor", "admin"];

export default function UsersPage() {
  const { data: me } = useMe();
  const usersQuery = useUsers();
  const createUser = useCreateUser();
  const updateRole = useUpdateUserRole();
  const deleteUser = useDeleteUser();
  const toast = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUserRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRecord | null>(
    null
  );
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<AdminRole>("viewer");
  const [editRole, setEditRole] = useState<AdminRole>("viewer");

  const adminCount = useMemo(
    () => (usersQuery.data ?? []).filter((u) => u.role === "admin").length,
    [usersQuery.data]
  );

  const forbidden =
    usersQuery.error instanceof APIClientError &&
    usersQuery.error.status === 403;

  const onAddSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await createUser.mutateAsync({ email: addEmail.trim(), role: addRole });
      toast.push("User added", "success");
      setAddOpen(false);
      setAddEmail("");
      setAddRole("viewer");
    } catch (err) {
      toast.push(
        err instanceof Error ? err.message : "Failed to add user",
        "error"
      );
    }
  };

  const onEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editUser) {
      return;
    }
    try {
      await updateRole.mutateAsync({ email: editUser.email, role: editRole });
      toast.push("Role updated", "success");
      setEditUser(null);
    } catch (err) {
      toast.push(
        err instanceof Error ? err.message : "Failed to update role",
        "error"
      );
    }
  };

  const onConfirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    try {
      await deleteUser.mutateAsync(deleteTarget.email);
      toast.push("User deleted", "success");
      setDeleteTarget(null);
    } catch (err) {
      toast.push(
        err instanceof Error ? err.message : "Failed to delete user",
        "error"
      );
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setAddOpen(true)}
            type="button"
          >
            Add user
          </button>
        }
        description="Manage admin dashboard access. Pre-provision roles before a user's first sign-in."
        title="Users"
      />

      {forbidden ? (
        <ErrorAlert message="You do not have permission to view this page." />
      ) : usersQuery.isLoading ? (
        <LoadingBlock />
      ) : usersQuery.isError ? (
        <ErrorAlert
          message={
            usersQuery.error instanceof Error
              ? usersQuery.error.message
              : "Failed to load users"
          }
        />
      ) : (
        <UsersTable
          adminCount={adminCount}
          currentEmail={me?.email}
          onDelete={setDeleteTarget}
          onEdit={(user) => {
            setEditUser(user);
            setEditRole(user.role);
          }}
          users={usersQuery.data ?? []}
        />
      )}

      {addOpen ? (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-semibold text-lg">Add user</h3>
            <form className="mt-4 space-y-4" onSubmit={onAddSubmit}>
              <label className="form-control w-full">
                <span className="label-text">Email</span>
                <input
                  className="input input-bordered w-full"
                  onChange={(e) => setAddEmail(e.target.value)}
                  required
                  type="email"
                  value={addEmail}
                />
              </label>
              <label className="form-control w-full">
                <span className="label-text">Role</span>
                <select
                  className="select select-bordered w-full"
                  onChange={(e) => setAddRole(e.target.value as AdminRole)}
                  value={addRole}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <div className="modal-action">
                <button
                  className="btn btn-ghost"
                  onClick={() => setAddOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  disabled={createUser.isPending}
                  type="submit"
                >
                  Add
                </button>
              </div>
            </form>
          </div>
          <form className="modal-backdrop" method="dialog">
            <button onClick={() => setAddOpen(false)} type="button">
              close
            </button>
          </form>
        </dialog>
      ) : null}

      {editUser ? (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-semibold text-lg">Edit role</h3>
            <p className="mt-1 text-base-content/60 text-sm">
              {editUser.email}
            </p>
            <form className="mt-4 space-y-4" onSubmit={onEditSubmit}>
              <label className="form-control w-full">
                <span className="label-text">Role</span>
                <select
                  className="select select-bordered w-full"
                  disabled={
                    editUser.email === me?.email && editUser.role === "admin"
                  }
                  onChange={(e) => setEditRole(e.target.value as AdminRole)}
                  value={editRole}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <div className="modal-action">
                <button
                  className="btn btn-ghost"
                  onClick={() => setEditUser(null)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  disabled={updateRole.isPending}
                  type="submit"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
          <form className="modal-backdrop" method="dialog">
            <button onClick={() => setEditUser(null)} type="button">
              close
            </button>
          </form>
        </dialog>
      ) : null}

      {deleteTarget ? (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-semibold text-lg">Delete user</h3>
            <p className="py-4">
              Remove <span className="font-medium">{deleteTarget.email}</span>?
              They will be re-created as a viewer on next sign-in.
            </p>
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                onClick={() => setDeleteTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="btn btn-error"
                disabled={deleteUser.isPending}
                onClick={onConfirmDelete}
                type="button"
              >
                Delete
              </button>
            </div>
          </div>
          <form className="modal-backdrop" method="dialog">
            <button onClick={() => setDeleteTarget(null)} type="button">
              close
            </button>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}
