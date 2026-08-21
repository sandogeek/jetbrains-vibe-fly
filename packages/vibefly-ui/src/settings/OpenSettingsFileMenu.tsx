import {FileJson} from "lucide-react"
import {useAppTranslation} from "../i18n"
import type {Ui2HostSettings} from "../generated/rpc"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "../components/ui/dropdown-menu"
import {SidebarMenu, SidebarMenuButton, SidebarMenuItem} from "../components/ui/sidebar"

const APPLICATION_SETTINGS_FILES = ["settings.json", "settings.vibefly.json", "models.json"] as const
const PROJECT_SETTINGS_FILES = ["settings.json", "settings.vibefly.json"] as const

export function OpenSettingsFileMenu(props: {
    host: Ui2HostSettings | null
    onError: (message: string) => void
}) {
    const {t} = useAppTranslation(["settings"])
    const label = t("settings:openSettingsFile")

    const openFile = async (scope: "application" | "project", document: string) => {
        if (!props.host) {
            props.onError(t("settings:hostUnavailableShort"))
            return
        }
        try {
            const result = await props.host.openSettingsFile(scope, document)
            if (!result.ok) {
                props.onError(result.error?.trim() || t("settings:openFileFailed"))
            }
        } catch (error) {
            props.onError(error instanceof Error ? error.message : String(error))
        }
    }

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton tooltip={label} disabled={!props.host}>
                            <FileJson/>
                            <span>{label}</span>
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="top" align="start" className="min-w-56">
                        <DropdownMenuGroup>
                            <DropdownMenuLabel>{t("settings:openSettingsFileApplication")}</DropdownMenuLabel>
                            {APPLICATION_SETTINGS_FILES.map((document) => (
                                <DropdownMenuItem
                                    key={`application:${document}`}
                                    onSelect={() => {
                                        void openFile("application", document)
                                    }}
                                >
                                    {document}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator/>
                        <DropdownMenuGroup>
                            <DropdownMenuLabel>{t("settings:openSettingsFileProject")}</DropdownMenuLabel>
                            {PROJECT_SETTINGS_FILES.map((document) => (
                                <DropdownMenuItem
                                    key={`project:${document}`}
                                    onSelect={() => {
                                        void openFile("project", document)
                                    }}
                                >
                                    {document}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    )
}
