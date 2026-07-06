import Foundation

struct NeXaAPIClient {
    func uploadRoomScan(
        _ payload: RoomPlanPayload,
        baseURL: String,
        projectId: String,
        username: String,
        password: String
    ) async throws -> RoomScanUploadResponse {
        let cleanBaseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !cleanBaseURL.isEmpty else {
            throw NeXaAPIError.missingBaseURL
        }

        let encodedProjectId = projectId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? projectId
        guard let url = URL(string: "\(cleanBaseURL)/api/takeoff-projects/\(encodedProjectId)/room-scans") else {
            throw NeXaAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Manager", forHTTPHeaderField: "x-hubflo-role")
        request.setValue(payload.actor, forHTTPHeaderField: "x-hubflo-employee-id")

        if !username.isEmpty || !password.isEmpty {
            let token = Data("\(username):\(password)".utf8).base64EncodedString()
            request.setValue("Basic \(token)", forHTTPHeaderField: "Authorization")
        }

        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw NeXaAPIError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(httpResponse.statusCode)"
            switch httpResponse.statusCode {
            case 401:
                throw NeXaAPIError.unauthorised
            case 403:
                throw NeXaAPIError.forbidden
            case 404:
                throw NeXaAPIError.projectNotFound(projectId)
            default:
                throw NeXaAPIError.server(httpResponse.statusCode, message)
            }
        }

        return try JSONDecoder().decode(RoomScanUploadResponse.self, from: data)
    }
}

struct RoomScanUploadResponse: Decodable {
    var imported: ImportedSummary

    struct ImportedSummary: Decodable {
        var rooms: Int
        var measurements: Int
    }
}

enum NeXaAPIError: LocalizedError {
    case missingBaseURL
    case invalidURL
    case invalidResponse
    case unauthorised
    case forbidden
    case projectNotFound(String)
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .missingBaseURL:
            return "Enter the NeXa web address before uploading."
        case .invalidURL:
            return "The NeXa web address is not valid."
        case .invalidResponse:
            return "NeXa did not return a valid response."
        case .unauthorised:
            return "NeXa rejected the scan. Check the pilot username and password in scanner settings."
        case .forbidden:
            return "NeXa received the scan but this app is not allowed to create or edit takeoff data."
        case .projectNotFound(let projectId):
            return "NeXa could not find project \(projectId). Open the scanner from the survey page so it links to the right project."
        case .server(let statusCode, let message):
            return "NeXa rejected the scan with HTTP \(statusCode): \(message)"
        }
    }
}
